import pytest
from fastapi.testclient import TestClient

from app.models.supplier import Supplier
from tests.conftest import get_auth_headers


# ============== SUPPLIER CREATION TESTS ==============

def test_create_supplier_as_supervisor(client: TestClient, db_session, supervisor_user):
    """Test that supervisors can create suppliers."""
    headers = get_auth_headers(client, supervisor_user.email)

    response = client.post(
        "/api/v1/suppliers",
        headers=headers,
        json={
            "name": "Sysco Foods",
            "contact_name": "Jane Doe",
            "email": "jane@sysco.com",
            "phone": "555-9876",
            "address": "123 Supply St",
            "notes": "Preferred vendor",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Sysco Foods"
    assert data["contact_name"] == "Jane Doe"
    assert data["email"] == "jane@sysco.com"
    assert data["phone"] == "555-9876"
    assert data["address"] == "123 Supply St"
    assert data["notes"] == "Preferred vendor"
    assert data["is_active"] is True


def test_create_supplier_as_admin(client: TestClient, db_session, admin_user):
    """Test that admins can create suppliers."""
    headers = get_auth_headers(client, admin_user.email)

    response = client.post(
        "/api/v1/suppliers",
        headers=headers,
        json={"name": "Alaska Provisions"},
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Alaska Provisions"
    assert data["is_active"] is True


def test_create_supplier_as_camp_worker_fails(client: TestClient, db_session, camp_worker_user):
    """Test that camp workers cannot create suppliers."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.post(
        "/api/v1/suppliers",
        headers=headers,
        json={"name": "Unauthorized Supplier"},
    )

    assert response.status_code == 403


# ============== SUPPLIER LIST TESTS ==============

def test_list_suppliers(client: TestClient, db_session, test_supplier, admin_user):
    """Test listing all active suppliers."""
    headers = get_auth_headers(client, admin_user.email)

    response = client.get("/api/v1/suppliers", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    names = [s["name"] for s in data]
    assert "Test Supplier" in names


def test_list_suppliers_with_search(client: TestClient, db_session, test_supplier, admin_user):
    """Test filtering suppliers by search query."""
    # Create an additional supplier to verify the filter narrows results
    extra = Supplier(name="Northern Foods", is_active=True)
    db_session.add(extra)
    db_session.commit()

    headers = get_auth_headers(client, admin_user.email)

    response = client.get("/api/v1/suppliers?search=Northern", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Northern Foods"


# ============== GET SUPPLIER DETAIL TESTS ==============

def test_get_supplier_with_stats(client: TestClient, db_session, test_supplier, admin_user):
    """Test getting a single supplier returns stats fields."""
    headers = get_auth_headers(client, admin_user.email)

    response = client.get(f"/api/v1/suppliers/{test_supplier.id}", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == test_supplier.id
    assert data["name"] == "Test Supplier"
    assert "item_count" in data
    assert "total_orders" in data
    assert "total_spent" in data
    assert data["item_count"] >= 0
    assert data["total_orders"] >= 0
    assert data["total_spent"] >= 0.0


def test_get_nonexistent_supplier(client: TestClient, db_session, admin_user):
    """Test that requesting a non-existent supplier returns 404."""
    headers = get_auth_headers(client, admin_user.email)

    response = client.get("/api/v1/suppliers/99999", headers=headers)

    assert response.status_code == 404


# ============== SUPPLIER UPDATE TESTS ==============

def test_update_supplier_as_supervisor(client: TestClient, db_session, test_supplier, supervisor_user):
    """Test that supervisors can update suppliers."""
    headers = get_auth_headers(client, supervisor_user.email)

    response = client.put(
        f"/api/v1/suppliers/{test_supplier.id}",
        headers=headers,
        json={
            "name": "Updated Supplier Name",
            "phone": "555-0000",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Supplier Name"
    assert data["phone"] == "555-0000"
    # Fields not included in the update should remain unchanged
    assert data["contact_name"] == "John Contact"


def test_update_supplier_as_camp_worker_fails(client: TestClient, db_session, test_supplier, camp_worker_user):
    """Test that camp workers cannot update suppliers."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.put(
        f"/api/v1/suppliers/{test_supplier.id}",
        headers=headers,
        json={"name": "Should Not Work"},
    )

    assert response.status_code == 403


# ============== SUPPLIER DELETE TESTS ==============

def test_delete_supplier_as_admin(client: TestClient, db_session, test_supplier, admin_user):
    """Test that admins can soft-delete a supplier."""
    headers = get_auth_headers(client, admin_user.email)

    response = client.delete(f"/api/v1/suppliers/{test_supplier.id}", headers=headers)

    assert response.status_code == 204

    # Verify the supplier is soft-deleted in the database
    db_session.refresh(test_supplier)
    assert test_supplier.is_active is False


def test_deleted_supplier_not_in_list(client: TestClient, db_session, test_supplier, admin_user):
    """Test that soft-deleted suppliers are excluded from the list endpoint."""
    headers = get_auth_headers(client, admin_user.email)

    # Soft-delete the supplier
    test_supplier.is_active = False
    db_session.commit()

    response = client.get("/api/v1/suppliers", headers=headers)

    assert response.status_code == 200
    data = response.json()
    supplier_ids = [s["id"] for s in data]
    assert test_supplier.id not in supplier_ids


# ============== AUTHENTICATION TESTS ==============

def test_unauthenticated_access_fails(client: TestClient, db_session):
    """Test that unauthenticated requests are rejected with 401."""
    response = client.get("/api/v1/suppliers")
    assert response.status_code == 401

    response = client.post("/api/v1/suppliers", json={"name": "No Auth"})
    assert response.status_code == 401

    response = client.put("/api/v1/suppliers/1", json={"name": "No Auth"})
    assert response.status_code == 401

    response = client.delete("/api/v1/suppliers/1")
    assert response.status_code == 401
