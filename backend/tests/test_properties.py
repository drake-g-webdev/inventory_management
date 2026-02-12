import pytest
from fastapi.testclient import TestClient

from app.models.user import User, UserRole
from app.models.property import Property
from app.models.inventory import InventoryItem
from app.models.order import Order, OrderStatus
from app.core.security import get_password_hash

from tests.conftest import get_auth_headers


# ============== CREATE PROPERTY TESTS ==============

def test_create_property_as_admin(client: TestClient, admin_headers):
    """Test that admins can create a new property."""
    response = client.post(
        "/api/v1/properties",
        headers=admin_headers,
        json={
            "name": "Eagle Nest Lodge",
            "code": "ENL",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Eagle Nest Lodge"
    assert data["code"] == "ENL"
    assert data["is_active"] is True
    assert "id" in data
    assert "created_at" in data


def test_create_property_duplicate_code_fails(client: TestClient, admin_headers, test_property):
    """Test that creating a property with an existing code returns 400."""
    response = client.post(
        "/api/v1/properties",
        headers=admin_headers,
        json={
            "name": "Another Camp",
            "code": "YRC",  # Already used by test_property
        },
    )

    assert response.status_code == 400
    assert "code already exists" in response.json()["detail"].lower()


def test_create_property_as_non_admin_fails(client: TestClient, db_session, camp_worker_user):
    """Test that non-admin users cannot create properties."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.post(
        "/api/v1/properties",
        headers=headers,
        json={
            "name": "Unauthorized Camp",
            "code": "UC",
        },
    )

    assert response.status_code == 403


# ============== LIST PROPERTIES TESTS ==============

def test_list_properties_admin_sees_all(client: TestClient, admin_headers, test_property, second_property):
    """Test that admins see all active properties."""
    response = client.get("/api/v1/properties", headers=admin_headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 2
    codes = [p["code"] for p in data]
    assert "YRC" in codes
    assert "DBC" in codes


def test_list_properties_camp_worker_sees_own(client: TestClient, db_session, camp_worker_user, test_property, second_property):
    """Test that camp workers only see their assigned property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.get("/api/v1/properties", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["code"] == "YRC"
    assert data[0]["id"] == test_property.id


def test_list_properties_camp_worker_no_property_gets_empty(client: TestClient, db_session):
    """Test that a camp worker with no assigned property gets an empty list."""
    unassigned_worker = User(
        email="unassigned@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Unassigned Worker",
        role=UserRole.CAMP_WORKER.value,
        property_id=None,
        is_active=True,
    )
    db_session.add(unassigned_worker)
    db_session.commit()

    headers = get_auth_headers(client, "unassigned@example.com")

    response = client.get("/api/v1/properties", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data == []


# ============== GET PROPERTY WITH STATS TESTS ==============

def test_get_property_with_stats(client: TestClient, db_session, admin_headers, test_property, test_supplier):
    """Test getting a property returns correct user_count, inventory_item_count, and pending_orders_count."""
    # Create users assigned to the property
    worker1 = User(
        email="worker1@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Worker One",
        role=UserRole.CAMP_WORKER.value,
        property_id=test_property.id,
        is_active=True,
    )
    worker2 = User(
        email="worker2@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Worker Two",
        role=UserRole.CAMP_WORKER.value,
        property_id=test_property.id,
        is_active=True,
    )
    db_session.add_all([worker1, worker2])
    db_session.commit()

    # Create inventory items for the property
    item1 = InventoryItem(
        name="Flour",
        category="Dry Goods",
        unit="lb",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=25.0,
    )
    item2 = InventoryItem(
        name="Sugar",
        category="Dry Goods",
        unit="lb",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=30.0,
        current_stock=10.0,
    )
    db_session.add_all([item1, item2])
    db_session.commit()

    # Create orders with various statuses
    draft_order = Order(
        order_number="TEST-YRC-001",
        property_id=test_property.id,
        status=OrderStatus.DRAFT.value,
        created_by=worker1.id,
        estimated_total=0.0,
    )
    submitted_order = Order(
        order_number="TEST-YRC-002",
        property_id=test_property.id,
        status=OrderStatus.SUBMITTED.value,
        created_by=worker1.id,
        estimated_total=0.0,
    )
    received_order = Order(
        order_number="TEST-YRC-003",
        property_id=test_property.id,
        status=OrderStatus.RECEIVED.value,
        created_by=worker1.id,
        estimated_total=0.0,
    )
    db_session.add_all([draft_order, submitted_order, received_order])
    db_session.commit()

    response = client.get(f"/api/v1/properties/{test_property.id}", headers=admin_headers)

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Yukon River Camp"
    assert data["code"] == "YRC"
    assert data["user_count"] == 2
    assert data["inventory_item_count"] == 2
    # Only draft and submitted count as pending (received does not)
    assert data["pending_orders_count"] == 2


def test_get_property_camp_worker_own(client: TestClient, db_session, camp_worker_user, test_property):
    """Test that a camp worker can view their own property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.get(f"/api/v1/properties/{test_property.id}", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == test_property.id
    assert data["code"] == "YRC"


def test_get_property_camp_worker_other_property_fails(client: TestClient, db_session, camp_worker_user, test_property, second_property):
    """Test that a camp worker cannot view another property."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.get(f"/api/v1/properties/{second_property.id}", headers=headers)

    assert response.status_code == 403
    assert "access denied" in response.json()["detail"].lower()


# ============== UPDATE PROPERTY TESTS ==============

def test_update_property_name_as_admin(client: TestClient, admin_headers, test_property):
    """Test that admins can update a property name."""
    response = client.put(
        f"/api/v1/properties/{test_property.id}",
        headers=admin_headers,
        json={"name": "Yukon River Camp - Updated"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Yukon River Camp - Updated"
    assert data["code"] == "YRC"  # Code unchanged


def test_update_property_code_to_existing_fails(client: TestClient, admin_headers, test_property, second_property):
    """Test that updating a property code to an existing code returns 400."""
    response = client.put(
        f"/api/v1/properties/{test_property.id}",
        headers=admin_headers,
        json={"code": "DBC"},  # Already used by second_property
    )

    assert response.status_code == 400
    assert "code already exists" in response.json()["detail"].lower()


# ============== DELETE PROPERTY TESTS ==============

def test_delete_property_soft_deletes(client: TestClient, db_session, admin_headers, test_property):
    """Test that deleting a property soft-deletes it by setting is_active=False."""
    response = client.delete(
        f"/api/v1/properties/{test_property.id}",
        headers=admin_headers,
    )

    assert response.status_code == 204

    # Verify soft delete in database
    db_session.refresh(test_property)
    assert test_property.is_active is False


def test_delete_property_as_non_admin_fails(client: TestClient, db_session, camp_worker_user, test_property):
    """Test that non-admin users cannot delete properties."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.delete(
        f"/api/v1/properties/{test_property.id}",
        headers=headers,
    )

    assert response.status_code == 403


# ============== UNAUTHENTICATED ACCESS TESTS ==============

def test_unauthenticated_access_fails(client: TestClient, test_property):
    """Test that unauthenticated requests to all property endpoints return 401."""
    # List
    response = client.get("/api/v1/properties")
    assert response.status_code == 401

    # Get
    response = client.get(f"/api/v1/properties/{test_property.id}")
    assert response.status_code == 401

    # Create
    response = client.post(
        "/api/v1/properties",
        json={"name": "Sneaky Camp", "code": "SC"},
    )
    assert response.status_code == 401

    # Update
    response = client.put(
        f"/api/v1/properties/{test_property.id}",
        json={"name": "Hacked Camp"},
    )
    assert response.status_code == 401

    # Delete
    response = client.delete(f"/api/v1/properties/{test_property.id}")
    assert response.status_code == 401
