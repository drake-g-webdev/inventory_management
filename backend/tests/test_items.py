import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def category(client: TestClient, auth_headers):
    """Create a test category."""
    response = client.post(
        "/api/v1/categories",
        json={"name": "Test Category"},
        headers=auth_headers,
    )
    return response.json()


@pytest.fixture
def supplier(client: TestClient, auth_headers):
    """Create a test supplier."""
    response = client.post(
        "/api/v1/suppliers",
        json={"name": "Test Supplier"},
        headers=auth_headers,
    )
    return response.json()


def test_create_item(client: TestClient, auth_headers, category, supplier):
    """Test creating an item."""
    response = client.post(
        "/api/v1/items",
        json={
            "name": "Test Item",
            "brand": "Test Brand",
            "category_id": category["id"],
            "supplier_id": supplier["id"],
            "quantity_per_unit": 10,
            "unit": "OZ",
            "price": 9.99,
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Item"
    assert data["brand"] == "Test Brand"
    assert data["price"] == 9.99
    assert data["category_name"] == "Test Category"
    assert data["supplier_name"] == "Test Supplier"


def test_get_items(client: TestClient, auth_headers, category):
    """Test getting all items."""
    # Create an item
    client.post(
        "/api/v1/items",
        json={"name": "Item 1", "category_id": category["id"]},
        headers=auth_headers,
    )

    response = client.get("/api/v1/items", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_filter_items_by_category(client: TestClient, auth_headers, category):
    """Test filtering items by category."""
    client.post(
        "/api/v1/items",
        json={"name": "Filtered Item", "category_id": category["id"]},
        headers=auth_headers,
    )

    response = client.get(
        f"/api/v1/items?category_id={category['id']}", headers=auth_headers
    )
    assert response.status_code == 200
    items = response.json()
    assert all(item["category_id"] == category["id"] for item in items)


def test_search_items(client: TestClient, auth_headers):
    """Test searching items."""
    client.post(
        "/api/v1/items",
        json={"name": "Unique Searchable Item"},
        headers=auth_headers,
    )

    response = client.get("/api/v1/items?search=Unique", headers=auth_headers)
    assert response.status_code == 200
    items = response.json()
    assert any("Unique" in item["name"] for item in items)


def test_update_item(client: TestClient, auth_headers):
    """Test updating an item."""
    # Create item
    create_response = client.post(
        "/api/v1/items",
        json={"name": "Original Item", "price": 5.99},
        headers=auth_headers,
    )
    item_id = create_response.json()["id"]

    # Update it
    response = client.put(
        f"/api/v1/items/{item_id}",
        json={"name": "Updated Item", "price": 10.99},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Item"
    assert data["price"] == 10.99


def test_delete_item(client: TestClient, auth_headers):
    """Test deleting an item."""
    # Create item
    create_response = client.post(
        "/api/v1/items",
        json={"name": "To Delete"},
        headers=auth_headers,
    )
    item_id = create_response.json()["id"]

    # Delete it
    response = client.delete(f"/api/v1/items/{item_id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's deleted
    get_response = client.get(f"/api/v1/items/{item_id}", headers=auth_headers)
    assert get_response.status_code == 404
