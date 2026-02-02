import pytest
from fastapi.testclient import TestClient


def test_create_category(client: TestClient, auth_headers):
    """Test creating a category."""
    response = client.post(
        "/api/v1/categories",
        json={"name": "Test Category", "description": "A test category"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Category"
    assert data["description"] == "A test category"
    assert "id" in data


def test_create_category_unauthorized(client: TestClient):
    """Test creating category without auth fails."""
    response = client.post(
        "/api/v1/categories",
        json={"name": "Test Category"},
    )
    assert response.status_code == 401


def test_get_categories(client: TestClient, auth_headers):
    """Test getting all categories."""
    # Create a category first
    client.post(
        "/api/v1/categories",
        json={"name": "Category 1"},
        headers=auth_headers,
    )

    response = client.get("/api/v1/categories", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1


def test_get_category_by_id(client: TestClient, auth_headers):
    """Test getting a single category by ID."""
    # Create a category
    create_response = client.post(
        "/api/v1/categories",
        json={"name": "Single Category"},
        headers=auth_headers,
    )
    category_id = create_response.json()["id"]

    response = client.get(f"/api/v1/categories/{category_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Single Category"


def test_update_category(client: TestClient, auth_headers):
    """Test updating a category."""
    # Create a category
    create_response = client.post(
        "/api/v1/categories",
        json={"name": "Original Name"},
        headers=auth_headers,
    )
    category_id = create_response.json()["id"]

    # Update it
    response = client.put(
        f"/api/v1/categories/{category_id}",
        json={"name": "Updated Name"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"


def test_delete_category(client: TestClient, auth_headers):
    """Test deleting a category."""
    # Create a category
    create_response = client.post(
        "/api/v1/categories",
        json={"name": "To Delete"},
        headers=auth_headers,
    )
    category_id = create_response.json()["id"]

    # Delete it
    response = client.delete(f"/api/v1/categories/{category_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's deleted
    get_response = client.get(f"/api/v1/categories/{category_id}", headers=auth_headers)
    assert get_response.status_code == 404
