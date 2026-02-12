import pytest
from fastapi.testclient import TestClient

from app.models.user import User, UserRole
from tests.conftest import get_auth_headers


# ============== CREATE USER ==============


def test_create_user_as_admin(client: TestClient, admin_headers, test_property):
    """Admin can create a new user."""
    response = client.post(
        "/api/v1/users",
        json={
            "email": "newcamp@example.com",
            "full_name": "New Camp Worker",
            "password": "securepass123",
            "role": "camp_worker",
            "property_id": test_property.id,
        },
        headers=admin_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "newcamp@example.com"
    assert data["full_name"] == "New Camp Worker"
    assert data["role"] == "camp_worker"
    assert data["property_id"] == test_property.id
    assert data["is_active"] is True
    assert "id" in data


def test_create_user_duplicate_email(client: TestClient, admin_headers, camp_worker_user):
    """Creating a user with an already-registered email returns 400."""
    response = client.post(
        "/api/v1/users",
        json={
            "email": camp_worker_user.email,
            "full_name": "Duplicate Email User",
            "password": "password123",
            "role": "camp_worker",
        },
        headers=admin_headers,
    )
    assert response.status_code == 400
    assert "already registered" in response.json()["detail"]


def test_create_user_as_non_admin_forbidden(client: TestClient, camp_worker_user):
    """Non-admin users cannot create users."""
    headers = get_auth_headers(client, camp_worker_user.email)
    response = client.post(
        "/api/v1/users",
        json={
            "email": "sneaky@example.com",
            "full_name": "Sneaky User",
            "password": "password123",
            "role": "camp_worker",
        },
        headers=headers,
    )
    assert response.status_code == 403


# ============== LIST USERS ==============


def test_list_users_as_admin(client: TestClient, admin_headers, camp_worker_user, supervisor_user):
    """Admin can list all users (includes the admin itself plus fixtures)."""
    response = client.get("/api/v1/users", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    # admin_user + camp_worker_user + supervisor_user = at least 3
    assert len(data) >= 3
    emails = [u["email"] for u in data]
    assert camp_worker_user.email in emails
    assert supervisor_user.email in emails


def test_list_users_filter_by_role(client: TestClient, admin_headers, camp_worker_user, supervisor_user):
    """Filtering by role returns only matching users."""
    response = client.get(
        "/api/v1/users",
        params={"role": "camp_worker"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert all(u["role"] == "camp_worker" for u in data)
    assert any(u["email"] == camp_worker_user.email for u in data)


def test_list_users_filter_by_property(
    client: TestClient, admin_headers, camp_worker_user, test_property, second_property
):
    """Filtering by property_id returns only users assigned to that property."""
    response = client.get(
        "/api/v1/users",
        params={"property_id": test_property.id},
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert all(u["property_id"] == test_property.id for u in data)


def test_list_users_as_non_admin_forbidden(client: TestClient, supervisor_user):
    """Non-admin users cannot list users."""
    headers = get_auth_headers(client, supervisor_user.email)
    response = client.get("/api/v1/users", headers=headers)
    assert response.status_code == 403


# ============== GET USER ==============


def test_get_user_by_id(client: TestClient, admin_headers, camp_worker_user, test_property):
    """Admin can fetch a single user with property_name populated."""
    response = client.get(
        f"/api/v1/users/{camp_worker_user.id}",
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == camp_worker_user.id
    assert data["email"] == camp_worker_user.email
    assert data["property_name"] == test_property.name


def test_get_nonexistent_user(client: TestClient, admin_headers):
    """Fetching a user that does not exist returns 404."""
    response = client.get("/api/v1/users/999999", headers=admin_headers)
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# ============== UPDATE USER ==============


def test_update_user_email(client: TestClient, admin_headers, camp_worker_user):
    """Admin can update a user's email address."""
    response = client.put(
        f"/api/v1/users/{camp_worker_user.id}",
        json={"email": "updated_worker@example.com"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "updated_worker@example.com"


def test_update_user_email_duplicate(client: TestClient, admin_headers, camp_worker_user, supervisor_user):
    """Updating to an email that is already taken returns 400."""
    response = client.put(
        f"/api/v1/users/{camp_worker_user.id}",
        json={"email": supervisor_user.email},
        headers=admin_headers,
    )
    assert response.status_code == 400
    assert "already in use" in response.json()["detail"]


def test_update_user_password(client: TestClient, admin_headers, camp_worker_user):
    """Admin can update a user's password; user can then log in with new password."""
    new_password = "brandnewpassword99"
    response = client.put(
        f"/api/v1/users/{camp_worker_user.id}",
        json={"password": new_password},
        headers=admin_headers,
    )
    assert response.status_code == 200

    # Verify the user can log in with the new password
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": camp_worker_user.email, "password": new_password},
    )
    assert login_response.status_code == 200
    assert "access_token" in login_response.json()


def test_update_user_role(client: TestClient, admin_headers, camp_worker_user):
    """Admin can change a user's role."""
    response = client.put(
        f"/api/v1/users/{camp_worker_user.id}",
        json={"role": "purchasing_team"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "purchasing_team"


# ============== DELETE USER ==============


def test_delete_user_as_admin(client: TestClient, admin_headers, camp_worker_user):
    """Admin can permanently delete another user."""
    response = client.delete(
        f"/api/v1/users/{camp_worker_user.id}",
        headers=admin_headers,
    )
    assert response.status_code == 204

    # Confirm the user is gone
    get_response = client.get(
        f"/api/v1/users/{camp_worker_user.id}",
        headers=admin_headers,
    )
    assert get_response.status_code == 404


def test_delete_self_fails(client: TestClient, admin_headers, admin_user):
    """Admin cannot delete their own account."""
    response = client.delete(
        f"/api/v1/users/{admin_user.id}",
        headers=admin_headers,
    )
    assert response.status_code == 400
    assert "Cannot delete yourself" in response.json()["detail"]


# ============== RESET PASSWORD ==============


def test_reset_password(client: TestClient, admin_headers, camp_worker_user):
    """Admin can reset a user's password and the temp password works for login."""
    response = client.post(
        f"/api/v1/users/{camp_worker_user.id}/reset-password",
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "temporary_password" in data
    temp_password = data["temporary_password"]
    assert len(temp_password) == 10

    # Verify the temporary password works for login
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": camp_worker_user.email, "password": temp_password},
    )
    assert login_response.status_code == 200
    assert "access_token" in login_response.json()
