import pytest
from fastapi.testclient import TestClient
from datetime import datetime

from app.models.user import User, UserRole
from app.models.property import Property
from app.models.inventory import InventoryItem
from app.models.order import Order, OrderItem, OrderStatus
from app.models.supplier import Supplier
from app.core.security import get_password_hash


# ============== FIXTURES ==============

@pytest.fixture(scope="function")
def test_property(db_session):
    """Create a test property."""
    prop = Property(
        name="Yukon River Camp",
        code="YRC",
        is_active=True,
    )
    db_session.add(prop)
    db_session.commit()
    db_session.refresh(prop)
    return prop


@pytest.fixture(scope="function")
def test_supplier(db_session):
    """Create a test supplier."""
    supplier = Supplier(
        name="Test Supplier",
        contact_name="John Contact",
        email="supplier@example.com",
        phone="555-1234",
    )
    db_session.add(supplier)
    db_session.commit()
    db_session.refresh(supplier)
    return supplier


@pytest.fixture(scope="function")
def test_inventory_item(db_session, test_property, test_supplier):
    """Create a test inventory item."""
    item = InventoryItem(
        name="Flour",
        category="Dry Goods",
        unit="lb",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=25.0,
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    return item


@pytest.fixture(scope="function")
def camp_worker_user(db_session, test_property):
    """Create a camp worker user assigned to test property."""
    user = User(
        email="campworker@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Camp Worker",
        role=UserRole.CAMP_WORKER.value,
        property_id=test_property.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def supervisor_user(db_session, test_property):
    """Create a purchasing supervisor user."""
    user = User(
        email="supervisor@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Supervisor User",
        role=UserRole.PURCHASING_SUPERVISOR.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def purchasing_team_user(db_session):
    """Create a purchasing team user."""
    user = User(
        email="purchaser@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Purchaser User",
        role=UserRole.PURCHASING_TEAM.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def admin_user(db_session):
    """Create an admin user."""
    user = User(
        email="admin@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Admin User",
        role=UserRole.ADMIN.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def get_auth_headers(client: TestClient, email: str, password: str = "password123"):
    """Helper to get auth headers for a user."""
    response = client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ============== ORDER CREATION TESTS ==============

def test_create_order_as_camp_worker(client: TestClient, db_session, camp_worker_user, test_property, test_inventory_item):
    """Test that camp workers can create orders for their property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                    "unit": "lb",
                }
            ],
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["property_id"] == test_property.id
    assert data["status"] == OrderStatus.DRAFT.value

    # GET the order to verify items (OrderResponse doesn't include items, OrderWithItems does)
    order_id = data["id"]
    get_response = client.get(f"/api/v1/orders/{order_id}", headers=headers)
    assert get_response.status_code == 200
    order_data = get_response.json()
    assert len(order_data["items"]) == 1
    assert order_data["items"][0]["requested_quantity"] == 10.0


def test_create_order_wrong_property_fails(client: TestClient, db_session, camp_worker_user, test_inventory_item):
    """Test that camp workers cannot create orders for other properties."""
    # Create another property
    other_property = Property(name="Other Camp", code="OC", is_active=True)
    db_session.add(other_property)
    db_session.commit()

    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "property_id": other_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )

    assert response.status_code == 403


def test_create_order_without_auth_fails(client: TestClient, test_property, test_inventory_item):
    """Test that unauthenticated users cannot create orders."""
    response = client.post(
        "/api/v1/orders",
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )

    assert response.status_code == 401


# ============== ORDER SUBMISSION TESTS ==============

def test_submit_order(client: TestClient, db_session, camp_worker_user, test_property, test_inventory_item):
    """Test submitting a draft order."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create order
    create_response = client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )
    order_id = create_response.json()["id"]

    # Submit order
    submit_response = client.post(
        f"/api/v1/orders/{order_id}/submit",
        headers=headers,
        json={},
    )

    assert submit_response.status_code == 200
    data = submit_response.json()
    assert data["status"] == OrderStatus.SUBMITTED.value
    assert data["submitted_at"] is not None


def test_submit_empty_order_fails(client: TestClient, db_session, camp_worker_user, test_property):
    """Test that submitting an order with no items fails."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create order without items
    create_response = client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "property_id": test_property.id,
            "items": [],
        },
    )
    order_id = create_response.json()["id"]

    # Try to submit
    submit_response = client.post(
        f"/api/v1/orders/{order_id}/submit",
        headers=headers,
        json={},
    )

    assert submit_response.status_code == 400
    assert "empty" in submit_response.json()["detail"].lower()


# ============== ORDER REVIEW TESTS ==============

def test_approve_order(client: TestClient, db_session, camp_worker_user, supervisor_user, test_property, test_inventory_item):
    """Test supervisor approving a submitted order."""
    worker_headers = get_auth_headers(client, camp_worker_user.email)
    supervisor_headers = get_auth_headers(client, supervisor_user.email)

    # Create and submit order
    create_response = client.post(
        "/api/v1/orders",
        headers=worker_headers,
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )
    order_id = create_response.json()["id"]

    client.post(f"/api/v1/orders/{order_id}/submit", headers=worker_headers, json={})

    # Approve order as supervisor
    review_response = client.post(
        f"/api/v1/orders/{order_id}/review",
        headers=supervisor_headers,
        json={"action": "approve"},
    )

    assert review_response.status_code == 200
    data = review_response.json()
    assert data["status"] == OrderStatus.APPROVED.value
    assert data["reviewed_at"] is not None


def test_request_changes_on_order(client: TestClient, db_session, camp_worker_user, supervisor_user, test_property, test_inventory_item):
    """Test supervisor requesting changes on an order."""
    worker_headers = get_auth_headers(client, camp_worker_user.email)
    supervisor_headers = get_auth_headers(client, supervisor_user.email)

    # Create and submit order
    create_response = client.post(
        "/api/v1/orders",
        headers=worker_headers,
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )
    order_id = create_response.json()["id"]

    client.post(f"/api/v1/orders/{order_id}/submit", headers=worker_headers, json={})

    # Request changes
    review_response = client.post(
        f"/api/v1/orders/{order_id}/review",
        headers=supervisor_headers,
        json={
            "action": "request_changes",
            "review_notes": "Please reduce flour quantity",
        },
    )

    assert review_response.status_code == 200
    data = review_response.json()
    assert data["status"] == OrderStatus.CHANGES_REQUESTED.value
    assert data["review_notes"] == "Please reduce flour quantity"


def test_camp_worker_cannot_review(client: TestClient, db_session, camp_worker_user, test_property, test_inventory_item):
    """Test that camp workers cannot review orders."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create and submit order
    create_response = client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )
    order_id = create_response.json()["id"]

    client.post(f"/api/v1/orders/{order_id}/submit", headers=headers, json={})

    # Try to approve as camp worker
    review_response = client.post(
        f"/api/v1/orders/{order_id}/review",
        headers=headers,
        json={"action": "approve"},
    )

    assert review_response.status_code == 403


# ============== ORDER RECEIVING TESTS ==============

def test_receive_order_items(client: TestClient, db_session, camp_worker_user, supervisor_user, purchasing_team_user, test_property, test_inventory_item):
    """Test receiving items for an ordered order."""
    worker_headers = get_auth_headers(client, camp_worker_user.email)
    supervisor_headers = get_auth_headers(client, supervisor_user.email)
    purchaser_headers = get_auth_headers(client, purchasing_team_user.email)

    # Create, submit, and approve order
    create_response = client.post(
        "/api/v1/orders",
        headers=worker_headers,
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )
    order_id = create_response.json()["id"]

    client.post(f"/api/v1/orders/{order_id}/submit", headers=worker_headers, json={})
    client.post(f"/api/v1/orders/{order_id}/review", headers=supervisor_headers, json={"action": "approve"})

    # Mark as ordered (purchasing team)
    client.post(f"/api/v1/orders/{order_id}/mark-ordered", headers=purchaser_headers, json={})

    # Get order to find item ID
    order_response = client.get(f"/api/v1/orders/{order_id}", headers=worker_headers)
    item_id = order_response.json()["items"][0]["id"]

    # Receive items
    receive_response = client.post(
        f"/api/v1/orders/{order_id}/receive",
        headers=worker_headers,
        json={
            "items": [
                {
                    "item_id": item_id,
                    "received_quantity": 10.0,
                    "has_issue": False,
                }
            ],
        },
    )

    assert receive_response.status_code == 200
    data = receive_response.json()
    assert data["status"] == OrderStatus.RECEIVED.value


def test_receive_with_issues_flags_item(client: TestClient, db_session, camp_worker_user, supervisor_user, purchasing_team_user, test_property, test_inventory_item):
    """Test receiving items with issues flags them."""
    worker_headers = get_auth_headers(client, camp_worker_user.email)
    supervisor_headers = get_auth_headers(client, supervisor_user.email)
    purchaser_headers = get_auth_headers(client, purchasing_team_user.email)

    # Create, submit, approve, and mark ordered
    create_response = client.post(
        "/api/v1/orders",
        headers=worker_headers,
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )
    order_id = create_response.json()["id"]

    client.post(f"/api/v1/orders/{order_id}/submit", headers=worker_headers, json={})
    client.post(f"/api/v1/orders/{order_id}/review", headers=supervisor_headers, json={"action": "approve"})
    client.post(f"/api/v1/orders/{order_id}/mark-ordered", headers=purchaser_headers, json={})

    order_response = client.get(f"/api/v1/orders/{order_id}", headers=worker_headers)
    item_id = order_response.json()["items"][0]["id"]

    # Receive with issue
    receive_response = client.post(
        f"/api/v1/orders/{order_id}/receive",
        headers=worker_headers,
        json={
            "items": [
                {
                    "item_id": item_id,
                    "received_quantity": 8.0,
                    "has_issue": True,
                    "issue_description": "Bag was torn, some flour spilled",
                }
            ],
        },
    )

    assert receive_response.status_code == 200

    # Check flagged items endpoint
    flagged_response = client.get("/api/v1/orders/flagged-items", headers=purchaser_headers)
    assert flagged_response.status_code == 200
    flagged_data = flagged_response.json()
    assert flagged_data["total_count"] >= 1


def test_receive_invalid_item_fails(client: TestClient, db_session, camp_worker_user, supervisor_user, purchasing_team_user, test_property, test_inventory_item):
    """Test that receiving with invalid item ID fails with clear error."""
    worker_headers = get_auth_headers(client, camp_worker_user.email)
    supervisor_headers = get_auth_headers(client, supervisor_user.email)
    purchaser_headers = get_auth_headers(client, purchasing_team_user.email)

    # Create, submit, approve, and mark ordered
    create_response = client.post(
        "/api/v1/orders",
        headers=worker_headers,
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )
    order_id = create_response.json()["id"]

    client.post(f"/api/v1/orders/{order_id}/submit", headers=worker_headers, json={})
    client.post(f"/api/v1/orders/{order_id}/review", headers=supervisor_headers, json={"action": "approve"})
    client.post(f"/api/v1/orders/{order_id}/mark-ordered", headers=purchaser_headers, json={})

    # Try to receive with invalid item ID
    receive_response = client.post(
        f"/api/v1/orders/{order_id}/receive",
        headers=worker_headers,
        json={
            "items": [
                {
                    "item_id": 99999,  # Invalid ID
                    "received_quantity": 10.0,
                    "has_issue": False,
                }
            ],
        },
    )

    assert receive_response.status_code == 400
    assert "not found" in receive_response.json()["detail"].lower()


# ============== PAGINATION TESTS ==============

def test_list_orders_pagination(client: TestClient, db_session, camp_worker_user, test_property, test_inventory_item):
    """Test order listing with pagination limits."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Create multiple orders directly in DB with unique order numbers
    for i in range(5):
        order = Order(
            order_number=f"TEST-{test_property.code}-{i}",
            property_id=test_property.id,
            status=OrderStatus.DRAFT.value,
            created_by=camp_worker_user.id,
            estimated_total=0.0,
        )
        db_session.add(order)
    db_session.commit()

    # Test with limit
    response = client.get("/api/v1/orders?limit=3", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 3

    # Test with skip
    response = client.get("/api/v1/orders?skip=2&limit=3", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 3


def test_pagination_limit_validation(client: TestClient, db_session, camp_worker_user, test_property):
    """Test that pagination limits are enforced."""
    headers = get_auth_headers(client, camp_worker_user.email)

    # Test invalid limit (too high)
    response = client.get("/api/v1/orders?limit=10000", headers=headers)
    assert response.status_code == 422  # Validation error

    # Test invalid skip (negative)
    response = client.get("/api/v1/orders?skip=-1", headers=headers)
    assert response.status_code == 422


# ============== AUTHORIZATION TESTS ==============

def test_list_orders_property_isolation(client: TestClient, db_session, camp_worker_user, test_property, test_inventory_item):
    """Test that camp workers only see their property's orders."""
    # Create another property and camp worker
    other_property = Property(name="Other Camp", code="OC", is_active=True)
    db_session.add(other_property)
    db_session.commit()

    other_worker = User(
        email="otherworker@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Other Worker",
        role=UserRole.CAMP_WORKER.value,
        property_id=other_property.id,
        is_active=True,
    )
    db_session.add(other_worker)
    db_session.commit()

    # Create order as first worker
    headers = get_auth_headers(client, camp_worker_user.email)
    client.post(
        "/api/v1/orders",
        headers=headers,
        json={
            "property_id": test_property.id,
            "items": [
                {
                    "inventory_item_id": test_inventory_item.id,
                    "requested_quantity": 10.0,
                }
            ],
        },
    )

    # Other worker should not see this order
    other_headers = get_auth_headers(client, other_worker.email)
    response = client.get("/api/v1/orders", headers=other_headers)
    assert response.status_code == 200
    assert len(response.json()) == 0
