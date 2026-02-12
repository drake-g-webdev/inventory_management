import pytest
from fastapi.testclient import TestClient

from app.models.user import User, UserRole
from app.models.property import Property
from app.models.inventory import InventoryItem, InventoryCount, InventoryCountItem
from app.models.supplier import Supplier
from app.core.security import get_password_hash

# Fixtures (test_property, second_property, test_supplier, test_inventory_item,
# camp_worker_user, supervisor_user, purchasing_team_user, admin_user, admin_headers)
# are defined in conftest.py.
from tests.conftest import get_auth_headers


# ============== INVENTORY ITEMS CRUD ==============

def test_create_inventory_item_as_camp_worker(client: TestClient, db_session, camp_worker_user, test_property, test_supplier):
    """Test that camp workers can create inventory items for their property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.post(
        "/api/v1/inventory/items",
        headers=headers,
        json={
            "name": "Sugar",
            "property_id": test_property.id,
            "category": "Dry Goods",
            "unit": "lb",
            "supplier_id": test_supplier.id,
            "par_level": 30.0,
            "current_stock": 15.0,
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Sugar"
    assert data["property_id"] == test_property.id
    assert data["category"] == "Dry Goods"
    assert data["unit"] == "lb"
    assert data["supplier_id"] == test_supplier.id
    assert data["par_level"] == 30.0
    assert data["current_stock"] == 15.0
    assert data["is_active"] is True


def test_create_inventory_item_wrong_property_fails(client: TestClient, db_session, camp_worker_user, second_property, test_supplier):
    """Test that camp workers cannot create inventory items for a different property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.post(
        "/api/v1/inventory/items",
        headers=headers,
        json={
            "name": "Sugar",
            "property_id": second_property.id,
            "category": "Dry Goods",
            "unit": "lb",
            "supplier_id": test_supplier.id,
            "par_level": 30.0,
            "current_stock": 15.0,
        },
    )

    assert response.status_code == 403


def test_list_inventory_items_for_property(client: TestClient, db_session, camp_worker_user, test_property, test_inventory_item):
    """Test listing inventory items for a property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.get(
        f"/api/v1/inventory/items?property_id={test_property.id}",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    item_names = [item["name"] for item in data]
    assert "Flour" in item_names


def test_list_inventory_items_low_stock_only(client: TestClient, db_session, camp_worker_user, test_property, test_supplier):
    """Test filtering inventory items by low stock only."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create an item that IS low stock (current_stock <= par_level)
    low_stock_item = InventoryItem(
        name="Rice",
        category="Dry Goods",
        unit="lb",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=100.0,
        current_stock=10.0,
    )
    # Create an item that is NOT low stock (current_stock > par_level)
    well_stocked_item = InventoryItem(
        name="Salt",
        category="Dry Goods",
        unit="lb",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=20.0,
        current_stock=50.0,
    )
    db_session.add_all([low_stock_item, well_stocked_item])
    db_session.commit()

    # Request low stock only
    response = client.get(
        f"/api/v1/inventory/items?property_id={test_property.id}&low_stock_only=true",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    # All returned items should be low stock
    for item in data:
        assert item["is_low_stock"] is True

    returned_names = [item["name"] for item in data]
    assert "Rice" in returned_names
    assert "Salt" not in returned_names


def test_get_inventory_item_by_id(client: TestClient, db_session, camp_worker_user, test_inventory_item):
    """Test getting a single inventory item with computed fields."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.get(
        f"/api/v1/inventory/items/{test_inventory_item.id}",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == test_inventory_item.id
    assert data["name"] == "Flour"
    # Flour has par_level=50, current_stock=25 so it is low stock
    assert "is_low_stock" in data
    assert data["is_low_stock"] is True
    # Should suggest ordering since stock is below par
    assert "suggested_order_qty" in data
    assert data["suggested_order_qty"] > 0


def test_get_inventory_item_wrong_property_fails(client: TestClient, db_session, camp_worker_user, test_property, second_property, test_supplier):
    """Test that a camp worker cannot get an item belonging to another property."""
    # Create an item on the second property
    other_item = InventoryItem(
        name="Pepper",
        category="Spices",
        unit="oz",
        property_id=second_property.id,
        supplier_id=test_supplier.id,
        par_level=10.0,
        current_stock=5.0,
    )
    db_session.add(other_item)
    db_session.commit()
    db_session.refresh(other_item)

    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.get(
        f"/api/v1/inventory/items/{other_item.id}",
        headers=headers,
    )

    assert response.status_code == 403


def test_update_inventory_item(client: TestClient, db_session, camp_worker_user, test_inventory_item):
    """Test updating an inventory item's par_level."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.put(
        f"/api/v1/inventory/items/{test_inventory_item.id}",
        headers=headers,
        json={
            "par_level": 75.0,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["par_level"] == 75.0
    # Name should remain unchanged
    assert data["name"] == "Flour"


def test_delete_inventory_item_soft_deletes(client: TestClient, db_session, camp_worker_user, test_inventory_item):
    """Test that deleting an inventory item soft deletes it (sets is_active=False)."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.delete(
        f"/api/v1/inventory/items/{test_inventory_item.id}",
        headers=headers,
    )

    assert response.status_code == 204

    # Verify the item is soft-deleted in the database
    db_session.refresh(test_inventory_item)
    assert test_inventory_item.is_active is False

    # The item should no longer appear in the active items list
    list_response = client.get(
        f"/api/v1/inventory/items?property_id={test_inventory_item.property_id}",
        headers=headers,
    )
    assert list_response.status_code == 200
    returned_ids = [item["id"] for item in list_response.json()]
    assert test_inventory_item.id not in returned_ids


# ============== CATEGORIES ==============

def test_list_categories_for_property(client: TestClient, db_session, camp_worker_user, test_property, test_supplier):
    """Test that listing categories returns distinct values for a property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create items with different categories
    items = [
        InventoryItem(name="Milk", category="Dairy", unit="gallon", property_id=test_property.id, supplier_id=test_supplier.id, par_level=10.0, current_stock=5.0),
        InventoryItem(name="Cheese", category="Dairy", unit="lb", property_id=test_property.id, supplier_id=test_supplier.id, par_level=5.0, current_stock=3.0),
        InventoryItem(name="Chicken", category="Protein", unit="lb", property_id=test_property.id, supplier_id=test_supplier.id, par_level=20.0, current_stock=10.0),
        InventoryItem(name="Flour", category="Dry Goods", unit="lb", property_id=test_property.id, supplier_id=test_supplier.id, par_level=50.0, current_stock=25.0),
    ]
    db_session.add_all(items)
    db_session.commit()

    response = client.get(
        f"/api/v1/inventory/items/categories?property_id={test_property.id}",
        headers=headers,
    )

    assert response.status_code == 200
    categories = response.json()
    assert isinstance(categories, list)
    assert "Dairy" in categories
    assert "Protein" in categories
    assert "Dry Goods" in categories
    # Dairy should appear only once despite two Dairy items
    assert categories.count("Dairy") == 1


# ============== INVENTORY COUNTS ==============

def test_create_count_updates_stock(client: TestClient, db_session, camp_worker_user, test_property, test_inventory_item):
    """Test that creating an inventory count updates the item's current_stock."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # test_inventory_item starts with current_stock=25.0
    assert test_inventory_item.current_stock == 25.0

    response = client.post(
        "/api/v1/inventory/counts",
        headers=headers,
        json={
            "property_id": test_property.id,
            "notes": "Weekly inventory count",
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "quantity": 30.0,
                }
            ],
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["property_id"] == test_property.id
    assert data["is_finalized"] is True

    # Verify the inventory item's current_stock was updated in the database
    db_session.refresh(test_inventory_item)
    assert test_inventory_item.current_stock == 30.0


def test_create_count_with_multiple_items(client: TestClient, db_session, camp_worker_user, test_property, test_supplier):
    """Test creating an inventory count with multiple items updates all stocks."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create two inventory items
    item_a = InventoryItem(
        name="Butter",
        category="Dairy",
        unit="lb",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=20.0,
        current_stock=10.0,
    )
    item_b = InventoryItem(
        name="Eggs",
        category="Dairy",
        unit="dozen",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=15.0,
        current_stock=5.0,
    )
    db_session.add_all([item_a, item_b])
    db_session.commit()
    db_session.refresh(item_a)
    db_session.refresh(item_b)

    response = client.post(
        "/api/v1/inventory/counts",
        headers=headers,
        json={
            "property_id": test_property.id,
            "notes": "Full count",
            "items": [
                {"inventory_item_id": item_a.id, "quantity": 18.0},
                {"inventory_item_id": item_b.id, "quantity": 12.0},
            ],
        },
    )

    assert response.status_code == 201

    # Verify both items were updated
    db_session.refresh(item_a)
    db_session.refresh(item_b)
    assert item_a.current_stock == 18.0
    assert item_b.current_stock == 12.0


def test_list_inventory_counts(client: TestClient, db_session, camp_worker_user, test_property, test_inventory_item):
    """Test listing inventory counts for a property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create a count first
    client.post(
        "/api/v1/inventory/counts",
        headers=headers,
        json={
            "property_id": test_property.id,
            "notes": "Test count",
            "items": [
                {"inventory_item_id": test_inventory_item.id, "quantity": 40.0},
            ],
        },
    )

    response = client.get(
        f"/api/v1/inventory/counts?property_id={test_property.id}",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert data[0]["property_id"] == test_property.id
    assert data[0]["is_finalized"] is True


def test_get_count_with_items_detail(client: TestClient, db_session, camp_worker_user, test_property, test_inventory_item):
    """Test getting a single inventory count with item details."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create a count
    create_response = client.post(
        "/api/v1/inventory/counts",
        headers=headers,
        json={
            "property_id": test_property.id,
            "notes": "Detailed count",
            "items": [
                {"inventory_item_id": test_inventory_item.id, "quantity": 35.0},
            ],
        },
    )
    count_id = create_response.json()["id"]

    # Get the count with details
    response = client.get(
        f"/api/v1/inventory/counts/{count_id}",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == count_id
    assert data["property_id"] == test_property.id
    assert data["notes"] == "Detailed count"
    assert len(data["items"]) == 1
    assert data["items"][0]["inventory_item_id"] == test_inventory_item.id
    assert data["items"][0]["quantity"] == 35.0
    assert data["items"][0]["item_name"] == "Flour"
    assert data["items"][0]["item_unit"] == "lb"


# ============== ACCESS CONTROL ==============

def test_camp_worker_can_only_see_own_property_items(client: TestClient, db_session, camp_worker_user, test_property, second_property, test_supplier):
    """Test that camp workers can only see inventory items from their assigned property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create an item on the camp worker's property
    own_item = InventoryItem(
        name="Own Flour",
        category="Dry Goods",
        unit="lb",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=25.0,
    )
    # Create an item on the other property
    other_item = InventoryItem(
        name="Other Flour",
        category="Dry Goods",
        unit="lb",
        property_id=second_property.id,
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=25.0,
    )
    db_session.add_all([own_item, other_item])
    db_session.commit()

    # Camp worker listing without specifying property_id defaults to their own property
    response = client.get("/api/v1/inventory/items", headers=headers)
    assert response.status_code == 200
    data = response.json()
    returned_property_ids = {item["property_id"] for item in data}
    # All items should belong to the camp worker's property only
    assert returned_property_ids == {test_property.id}

    # Explicitly requesting the other property should fail
    response = client.get(
        f"/api/v1/inventory/items?property_id={second_property.id}",
        headers=headers,
    )
    assert response.status_code == 403


def test_admin_can_see_all_items(client: TestClient, db_session, admin_user, test_property, second_property, test_supplier):
    """Test that admin users can see items from all properties when no filter is applied."""
    admin_hdrs = get_auth_headers(client, admin_user.email)

    # Create items on two different properties
    item_prop1 = InventoryItem(
        name="Admin Flour",
        category="Dry Goods",
        unit="lb",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=25.0,
    )
    item_prop2 = InventoryItem(
        name="Admin Sugar",
        category="Dry Goods",
        unit="lb",
        property_id=second_property.id,
        supplier_id=test_supplier.id,
        par_level=30.0,
        current_stock=15.0,
    )
    db_session.add_all([item_prop1, item_prop2])
    db_session.commit()

    # Admin listing without property filter should return items from both properties
    response = client.get("/api/v1/inventory/items", headers=admin_hdrs)
    assert response.status_code == 200
    data = response.json()
    returned_property_ids = {item["property_id"] for item in data}
    assert test_property.id in returned_property_ids
    assert second_property.id in returned_property_ids


def test_unauthenticated_access_fails(client: TestClient, test_property, test_inventory_item):
    """Test that unauthenticated requests to inventory endpoints return 401."""
    # List items
    response = client.get(f"/api/v1/inventory/items?property_id={test_property.id}")
    assert response.status_code == 401

    # Get item
    response = client.get(f"/api/v1/inventory/items/{test_inventory_item.id}")
    assert response.status_code == 401

    # Create item
    response = client.post(
        "/api/v1/inventory/items",
        json={
            "name": "Unauthorized Item",
            "property_id": test_property.id,
            "category": "Dry Goods",
            "unit": "lb",
            "par_level": 10.0,
            "current_stock": 5.0,
        },
    )
    assert response.status_code == 401

    # List counts
    response = client.get(f"/api/v1/inventory/counts?property_id={test_property.id}")
    assert response.status_code == 401

    # Create count
    response = client.post(
        "/api/v1/inventory/counts",
        json={
            "property_id": test_property.id,
            "items": [{"inventory_item_id": test_inventory_item.id, "quantity": 10.0}],
        },
    )
    assert response.status_code == 401
