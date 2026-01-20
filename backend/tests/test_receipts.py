"""
Tests for receipt processing and AI extraction logic.
"""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient
from datetime import datetime
import json

from app.models.user import User, UserRole
from app.models.property import Property
from app.models.supplier import Supplier
from app.models.inventory import InventoryItem, ReceiptCodeAlias
from app.models.order import Order, OrderItem
from app.models.receipt import Receipt
from app.core.security import get_password_hash
from app.api.endpoints.receipts import (
    match_supplier_by_name,
    get_receipt_aliases_for_matching,
    _update_inventory_prices_from_receipt,
)


@pytest.fixture
def test_property(db_session):
    """Create a test property."""
    prop = Property(
        name="Test Camp",
        code="TST",
        is_active=True
    )
    db_session.add(prop)
    db_session.commit()
    db_session.refresh(prop)
    return prop


@pytest.fixture
def test_supplier(db_session):
    """Create a test supplier."""
    supplier = Supplier(
        name="Costco",
        is_active=True
    )
    db_session.add(supplier)
    db_session.commit()
    db_session.refresh(supplier)
    return supplier


@pytest.fixture
def second_supplier(db_session):
    """Create a second test supplier."""
    supplier = Supplier(
        name="Sysco Food Services",
        is_active=True
    )
    db_session.add(supplier)
    db_session.commit()
    db_session.refresh(supplier)
    return supplier


@pytest.fixture
def purchasing_user(db_session, test_property):
    """Create a purchasing team user."""
    user = User(
        email="purchaser@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Purchaser User",
        role=UserRole.PURCHASING_TEAM,
        property_id=test_property.id,
        is_active=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def purchasing_headers(client, purchasing_user):
    """Get authentication headers for purchasing user."""
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "purchaser@example.com", "password": "password123"},
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_inventory_item(db_session, test_property, test_supplier):
    """Create a test inventory item."""
    item = InventoryItem(
        name="Large Eggs",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        category="Dairy",
        unit="dozen",
        unit_price=4.99,
        is_active=True,
        current_stock=10.0
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    return item


@pytest.fixture
def test_order(db_session, test_property, purchasing_user):
    """Create a test order."""
    order = Order(
        order_number="ORD-2024-001",
        property_id=test_property.id,
        created_by=purchasing_user.id,
        status="ordered",
        week_of=datetime.now()
    )
    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)
    return order


@pytest.fixture
def test_order_item(db_session, test_order, test_inventory_item, test_supplier):
    """Create a test order item."""
    order_item = OrderItem(
        order_id=test_order.id,
        inventory_item_id=test_inventory_item.id,
        supplier_id=test_supplier.id,
        requested_quantity=24,
        approved_quantity=24,
        unit="dozen"
    )
    db_session.add(order_item)
    db_session.commit()
    db_session.refresh(order_item)
    return order_item


class TestMatchSupplierByName:
    """Tests for the match_supplier_by_name helper function."""

    def test_exact_match(self, db_session, test_supplier):
        """Test exact name matching."""
        result = match_supplier_by_name("Costco", db_session)
        assert result is not None
        assert result.id == test_supplier.id
        assert result.name == "Costco"

    def test_case_insensitive_match(self, db_session, test_supplier):
        """Test case-insensitive matching."""
        result = match_supplier_by_name("costco", db_session)
        assert result is not None
        assert result.id == test_supplier.id

    def test_partial_match(self, db_session, second_supplier):
        """Test partial name matching."""
        result = match_supplier_by_name("Sysco", db_session)
        assert result is not None
        assert result.id == second_supplier.id

    def test_no_match(self, db_session, test_supplier):
        """Test no match returns None."""
        result = match_supplier_by_name("Unknown Store", db_session)
        assert result is None

    def test_empty_string(self, db_session, test_supplier):
        """Test empty string returns None."""
        result = match_supplier_by_name("", db_session)
        assert result is None

    def test_none_input(self, db_session, test_supplier):
        """Test None input returns None."""
        result = match_supplier_by_name(None, db_session)
        assert result is None

    def test_inactive_supplier_not_matched(self, db_session):
        """Test inactive suppliers are not matched."""
        inactive_supplier = Supplier(
            name="Inactive Store",
            is_active=False
        )
        db_session.add(inactive_supplier)
        db_session.commit()

        result = match_supplier_by_name("Inactive Store", db_session)
        assert result is None


class TestGetReceiptAliasesForMatching:
    """Tests for the get_receipt_aliases_for_matching function."""

    def test_get_aliases_for_supplier(self, db_session, test_property, test_supplier, test_inventory_item):
        """Test getting aliases for a specific supplier."""
        # Create an alias
        alias = ReceiptCodeAlias(
            inventory_item_id=test_inventory_item.id,
            supplier_id=test_supplier.id,
            receipt_code="LG EGGS 5DZ",
            is_active=True,
            match_count=1
        )
        db_session.add(alias)
        db_session.commit()

        aliases = get_receipt_aliases_for_matching(test_supplier.id, test_property.id, db_session)

        assert len(aliases) == 1
        assert aliases[0]["receipt_code"] == "LG EGGS 5DZ"
        assert aliases[0]["inventory_item_id"] == test_inventory_item.id

    def test_get_global_aliases(self, db_session, test_property, test_inventory_item):
        """Test getting aliases without supplier (global aliases)."""
        # Create a global alias (no supplier_id)
        alias = ReceiptCodeAlias(
            inventory_item_id=test_inventory_item.id,
            supplier_id=None,
            receipt_code="EGGS LARGE",
            is_active=True,
            match_count=1
        )
        db_session.add(alias)
        db_session.commit()

        # Should get global aliases when querying for any supplier
        aliases = get_receipt_aliases_for_matching(999, test_property.id, db_session)

        assert len(aliases) == 1
        assert aliases[0]["receipt_code"] == "EGGS LARGE"

    def test_inactive_aliases_excluded(self, db_session, test_property, test_supplier, test_inventory_item):
        """Test that inactive aliases are excluded."""
        alias = ReceiptCodeAlias(
            inventory_item_id=test_inventory_item.id,
            supplier_id=test_supplier.id,
            receipt_code="INACTIVE ALIAS",
            is_active=False,
            match_count=1
        )
        db_session.add(alias)
        db_session.commit()

        aliases = get_receipt_aliases_for_matching(test_supplier.id, test_property.id, db_session)

        assert len(aliases) == 0


class TestUpdateInventoryPricesFromReceipt:
    """Tests for the _update_inventory_prices_from_receipt function."""

    def test_update_price_from_matched_item(self, db_session, test_order_item, test_inventory_item):
        """Test updating inventory price from matched receipt line item."""
        line_items = [
            {
                "item_name": "Large Eggs",
                "matched_order_item_id": test_order_item.id,
                "unit_price": 5.99,
                "total_price": 143.76,
                "quantity": 24
            }
        ]

        updated_count = _update_inventory_prices_from_receipt(line_items, db_session)

        assert updated_count == 1
        db_session.refresh(test_inventory_item)
        assert test_inventory_item.unit_price == 5.99

    def test_skip_items_without_order_match(self, db_session, test_inventory_item):
        """Test that items without order item match are skipped."""
        line_items = [
            {
                "item_name": "Unmatched Item",
                "matched_order_item_id": None,
                "unit_price": 10.00
            }
        ]

        updated_count = _update_inventory_prices_from_receipt(line_items, db_session)

        assert updated_count == 0

    def test_skip_items_without_price(self, db_session, test_order_item, test_inventory_item):
        """Test that items without unit price are skipped."""
        original_price = test_inventory_item.unit_price

        line_items = [
            {
                "item_name": "Large Eggs",
                "matched_order_item_id": test_order_item.id,
                "unit_price": None
            }
        ]

        updated_count = _update_inventory_prices_from_receipt(line_items, db_session)

        assert updated_count == 0
        db_session.refresh(test_inventory_item)
        assert test_inventory_item.unit_price == original_price


class TestReceiptEndpoints:
    """Tests for receipt API endpoints."""

    def test_list_properties_for_receipts(self, client, purchasing_headers, test_property):
        """Test listing properties for receipt dropdown."""
        response = client.get(
            "/api/v1/receipts/properties",
            headers=purchasing_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert any(p["code"] == "TST" for p in data)

    def test_list_orders_for_property(self, client, purchasing_headers, test_property, test_order):
        """Test listing orders for a property."""
        response = client.get(
            f"/api/v1/receipts/orders-by-property/{test_property.id}",
            headers=purchasing_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert any(o["order_number"] == "ORD-2024-001" for o in data)

    def test_search_inventory_for_matching(self, client, purchasing_headers, test_property, test_inventory_item):
        """Test searching inventory for receipt matching."""
        response = client.get(
            f"/api/v1/receipts/search-inventory?property_id={test_property.id}&q=eggs",
            headers=purchasing_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert data[0]["name"] == "Large Eggs"

    def test_search_inventory_no_results(self, client, purchasing_headers, test_property):
        """Test searching inventory with no matches."""
        response = client.get(
            f"/api/v1/receipts/search-inventory?property_id={test_property.id}&q=nonexistent",
            headers=purchasing_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 0

    def test_match_receipt_item_creates_alias(
        self, client, db_session, purchasing_headers, test_property, test_supplier, test_inventory_item
    ):
        """Test matching a receipt item creates an alias."""
        response = client.post(
            "/api/v1/receipts/match-item",
            headers=purchasing_headers,
            json={
                "receipt_code": "EGGS LG 5DZ",
                "inventory_item_id": test_inventory_item.id,
                "supplier_id": test_supplier.id,
                "unit_price": 4.99
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["receipt_code"] == "EGGS LG 5DZ"
        assert data["inventory_item_id"] == test_inventory_item.id
        assert data["match_count"] == 1

    def test_match_receipt_item_increments_count(
        self, client, db_session, purchasing_headers, test_property, test_supplier, test_inventory_item
    ):
        """Test matching same item again increments count."""
        # First match
        client.post(
            "/api/v1/receipts/match-item",
            headers=purchasing_headers,
            json={
                "receipt_code": "TEST CODE",
                "inventory_item_id": test_inventory_item.id,
                "supplier_id": test_supplier.id
            }
        )

        # Second match (same code)
        response = client.post(
            "/api/v1/receipts/match-item",
            headers=purchasing_headers,
            json={
                "receipt_code": "TEST CODE",
                "inventory_item_id": test_inventory_item.id,
                "supplier_id": test_supplier.id
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["match_count"] == 2

    def test_list_receipt_aliases(
        self, client, db_session, purchasing_headers, test_property, test_supplier, test_inventory_item
    ):
        """Test listing receipt aliases for a property."""
        # Create an alias first
        alias = ReceiptCodeAlias(
            inventory_item_id=test_inventory_item.id,
            supplier_id=test_supplier.id,
            receipt_code="TEST ALIAS",
            is_active=True,
            match_count=5
        )
        db_session.add(alias)
        db_session.commit()

        response = client.get(
            f"/api/v1/receipts/aliases/{test_property.id}",
            headers=purchasing_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert any(a["receipt_code"] == "TEST ALIAS" for a in data)

    def test_delete_receipt_alias(
        self, client, db_session, purchasing_headers, test_property, test_supplier, test_inventory_item
    ):
        """Test deleting a receipt alias."""
        alias = ReceiptCodeAlias(
            inventory_item_id=test_inventory_item.id,
            supplier_id=test_supplier.id,
            receipt_code="TO DELETE",
            is_active=True,
            match_count=1
        )
        db_session.add(alias)
        db_session.commit()
        alias_id = alias.id

        response = client.delete(
            f"/api/v1/receipts/aliases/{alias_id}",
            headers=purchasing_headers
        )

        assert response.status_code == 204

        # Verify deletion
        deleted = db_session.query(ReceiptCodeAlias).filter(
            ReceiptCodeAlias.id == alias_id
        ).first()
        assert deleted is None

    def test_add_unmatched_to_inventory(
        self, client, purchasing_headers, test_property, test_supplier
    ):
        """Test adding unmatched receipt item to inventory."""
        response = client.post(
            "/api/v1/receipts/add-to-inventory",
            headers=purchasing_headers,
            json={
                "name": "New Item From Receipt",
                "property_id": test_property.id,
                "supplier_id": test_supplier.id,
                "category": "Grocery",
                "unit": "each",
                "unit_price": 15.99,
                "is_recurring": False
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "New Item From Receipt"
        assert data["property_id"] == test_property.id
        assert data["category"] == "Grocery"
        assert data["is_recurring"] == False

    def test_add_duplicate_to_inventory_fails(
        self, client, purchasing_headers, test_property, test_inventory_item
    ):
        """Test adding duplicate item to inventory fails."""
        response = client.post(
            "/api/v1/receipts/add-to-inventory",
            headers=purchasing_headers,
            json={
                "name": "Large Eggs",  # Same as test_inventory_item
                "property_id": test_property.id,
                "unit": "dozen"
            }
        )

        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]


class TestReceiptCRUD:
    """Tests for receipt CRUD operations."""

    def test_create_receipt(self, client, db_session, purchasing_headers, test_order, test_supplier):
        """Test creating a receipt record."""
        response = client.post(
            "/api/v1/receipts",
            headers=purchasing_headers,
            json={
                "order_id": test_order.id,
                "supplier_id": test_supplier.id,
                "image_url": "/uploads/receipts/test.jpg",
                "subtotal": 100.00,
                "tax": 8.50,
                "total": 108.50,
                "notes": "Test receipt"
            }
        )

        assert response.status_code == 201
        data = response.json()
        assert data["order_id"] == test_order.id
        assert data["total"] == 108.50

    def test_get_receipt(self, client, db_session, auth_headers, test_order, test_supplier, purchasing_user):
        """Test getting a receipt by ID."""
        receipt = Receipt(
            order_id=test_order.id,
            supplier_id=test_supplier.id,
            image_url="/uploads/receipts/test.jpg",
            total=100.00,
            uploaded_by=purchasing_user.id,
            is_processed=True
        )
        db_session.add(receipt)
        db_session.commit()

        response = client.get(
            f"/api/v1/receipts/{receipt.id}",
            headers=auth_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == receipt.id
        assert data["total"] == 100.00

    def test_update_receipt(self, client, db_session, purchasing_headers, test_order, test_supplier, purchasing_user):
        """Test updating a receipt."""
        receipt = Receipt(
            order_id=test_order.id,
            supplier_id=test_supplier.id,
            image_url="/uploads/receipts/test.jpg",
            total=100.00,
            uploaded_by=purchasing_user.id,
            is_processed=True
        )
        db_session.add(receipt)
        db_session.commit()

        response = client.put(
            f"/api/v1/receipts/{receipt.id}",
            headers=purchasing_headers,
            json={
                "total": 150.00,
                "notes": "Updated notes"
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 150.00
        assert data["notes"] == "Updated notes"

    def test_delete_receipt(self, client, db_session, purchasing_headers, test_order, test_supplier, purchasing_user):
        """Test deleting a receipt."""
        receipt = Receipt(
            order_id=test_order.id,
            supplier_id=test_supplier.id,
            image_url="/uploads/receipts/test.jpg",
            total=100.00,
            uploaded_by=purchasing_user.id,
            is_processed=True
        )
        db_session.add(receipt)
        db_session.commit()
        receipt_id = receipt.id

        response = client.delete(
            f"/api/v1/receipts/{receipt_id}",
            headers=purchasing_headers
        )

        assert response.status_code == 204

        # Verify deletion
        deleted = db_session.query(Receipt).filter(Receipt.id == receipt_id).first()
        assert deleted is None

    def test_verify_receipt(self, client, db_session, purchasing_headers, test_order, test_supplier, purchasing_user):
        """Test marking a receipt as verified."""
        receipt = Receipt(
            order_id=test_order.id,
            supplier_id=test_supplier.id,
            image_url="/uploads/receipts/test.jpg",
            total=100.00,
            uploaded_by=purchasing_user.id,
            is_processed=True,
            is_manually_verified=False
        )
        db_session.add(receipt)
        db_session.commit()

        response = client.post(
            f"/api/v1/receipts/{receipt.id}/verify",
            headers=purchasing_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert data["is_manually_verified"] == True


class TestReceiptLineItemOperations:
    """Tests for receipt line item operations."""

    def test_update_line_item(
        self, client, db_session, purchasing_headers, test_order, test_supplier, purchasing_user
    ):
        """Test updating a specific line item."""
        receipt = Receipt(
            order_id=test_order.id,
            supplier_id=test_supplier.id,
            image_url="/uploads/receipts/test.jpg",
            total=100.00,
            subtotal=90.00,
            uploaded_by=purchasing_user.id,
            is_processed=True,
            line_items=[
                {"item_name": "Item 1", "quantity": 2, "unit_price": 10.00, "total_price": 20.00},
                {"item_name": "Item 2", "quantity": 1, "unit_price": 70.00, "total_price": 70.00}
            ]
        )
        db_session.add(receipt)
        db_session.commit()

        response = client.put(
            f"/api/v1/receipts/{receipt.id}/line-items/0",
            headers=purchasing_headers,
            json={
                "quantity": 3,
                "unit_price": 10.00,
                "total_price": 30.00
            }
        )

        assert response.status_code == 200
        data = response.json()
        # Subtotal should be updated (90 - 20 + 30 = 100)
        assert data["subtotal"] == 100.00

    def test_delete_line_item(
        self, client, db_session, purchasing_headers, test_order, test_supplier, purchasing_user
    ):
        """Test deleting a line item from a receipt."""
        receipt = Receipt(
            order_id=test_order.id,
            supplier_id=test_supplier.id,
            image_url="/uploads/receipts/test.jpg",
            total=100.00,
            subtotal=90.00,
            uploaded_by=purchasing_user.id,
            is_processed=True,
            line_items=[
                {"item_name": "Item 1", "quantity": 2, "unit_price": 10.00, "total_price": 20.00},
                {"item_name": "Item 2", "quantity": 1, "unit_price": 70.00, "total_price": 70.00}
            ]
        )
        db_session.add(receipt)
        db_session.commit()

        response = client.delete(
            f"/api/v1/receipts/{receipt.id}/line-items/0",
            headers=purchasing_headers
        )

        assert response.status_code == 200
        data = response.json()
        # Should have only 1 item now
        assert len(data["line_items"]) == 1
        assert data["line_items"][0]["item_name"] == "Item 2"


class TestFinancialDashboard:
    """Tests for the financial dashboard endpoint."""

    def test_get_financial_dashboard(
        self, client, db_session, purchasing_headers, test_order, test_supplier, purchasing_user
    ):
        """Test getting financial dashboard data."""
        # Create some receipts
        receipt = Receipt(
            order_id=test_order.id,
            supplier_id=test_supplier.id,
            image_url="/uploads/receipts/test.jpg",
            total=500.00,
            uploaded_by=purchasing_user.id,
            is_processed=True,
            receipt_date=datetime.now()
        )
        db_session.add(receipt)
        db_session.commit()

        response = client.get(
            "/api/v1/receipts/financial-dashboard",
            headers=purchasing_headers
        )

        assert response.status_code == 200
        data = response.json()
        assert "total_spent_this_month" in data
        assert "total_spent_this_year" in data
        assert "spending_by_supplier" in data
        assert "spending_trend" in data
