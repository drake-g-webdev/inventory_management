import pytest
from fastapi.testclient import TestClient

from app.models.master_product import MasterProduct
from app.models.inventory import InventoryItem
from app.models.supplier import Supplier
from app.models.property import Property
from app.core.security import get_password_hash

from tests.conftest import get_auth_headers

API = "/api/v1/master-products"


# ============== HELPERS ==============

def _create_master_product(db_session, supplier=None, **overrides):
    """Helper to create a MasterProduct directly in the DB."""
    defaults = dict(
        name="All-Purpose Flour",
        sku="SKU-FLOUR-001",
        category="Dry Goods",
        unit="lb",
        default_par_level=50.0,
        default_order_at=20.0,
        brand="King Arthur",
        is_active=True,
    )
    if supplier:
        defaults["supplier_id"] = supplier.id
    defaults.update(overrides)
    product = MasterProduct(**defaults)
    db_session.add(product)
    db_session.commit()
    db_session.refresh(product)
    return product


def _master_product_payload(**overrides):
    """Return a JSON-serialisable dict suitable for the create endpoint."""
    payload = {
        "name": "All-Purpose Flour",
        "sku": "SKU-FLOUR-001",
        "category": "Dry Goods",
        "unit": "lb",
        "default_par_level": 50.0,
        "default_order_at": 20.0,
    }
    payload.update(overrides)
    return payload


# ============== CRUD TESTS ==============

def test_create_master_product_as_admin(client: TestClient, db_session, admin_user, test_supplier):
    """1. Admin can create a master product (201)."""
    headers = get_auth_headers(client, admin_user.email)
    payload = _master_product_payload(supplier_id=test_supplier.id)

    response = client.post(API, headers=headers, json=payload)

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "All-Purpose Flour"
    assert data["sku"] == "SKU-FLOUR-001"
    assert data["category"] == "Dry Goods"
    assert data["supplier_id"] == test_supplier.id
    assert data["supplier_name"] == test_supplier.name
    assert data["assigned_property_count"] == 0


def test_create_with_duplicate_sku_fails(client: TestClient, db_session, admin_user, test_supplier):
    """2. Creating a product with a duplicate SKU returns 400."""
    _create_master_product(db_session, supplier=test_supplier, sku="DUPE-SKU")
    headers = get_auth_headers(client, admin_user.email)

    payload = _master_product_payload(name="Another Product", sku="DUPE-SKU")
    response = client.post(API, headers=headers, json=payload)

    assert response.status_code == 400
    assert "SKU already exists" in response.json()["detail"]


def test_create_without_sku_is_ok(client: TestClient, db_session, admin_user):
    """3. SKU is optional -- products can be created without one."""
    headers = get_auth_headers(client, admin_user.email)
    payload = _master_product_payload(sku=None)

    response = client.post(API, headers=headers, json=payload)

    assert response.status_code == 201
    assert response.json()["sku"] is None


def test_create_as_non_admin_fails(client: TestClient, db_session, camp_worker_user):
    """4. Non-admin users (camp worker) get 403."""
    headers = get_auth_headers(client, camp_worker_user.email)
    payload = _master_product_payload()

    response = client.post(API, headers=headers, json=payload)

    assert response.status_code == 403


def test_list_products_with_assigned_property_count(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """5. GET list returns products with correct assigned_property_count."""
    product = _create_master_product(db_session, supplier=test_supplier)

    # Create an inventory item linked to this master product
    item = InventoryItem(
        property_id=test_property.id,
        master_product_id=product.id,
        name=product.name,
        category=product.category,
        unit=product.unit,
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=0,
    )
    db_session.add(item)
    db_session.commit()

    headers = get_auth_headers(client, admin_user.email)
    response = client.get(API, headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    matched = [p for p in data if p["id"] == product.id]
    assert len(matched) == 1
    assert matched[0]["assigned_property_count"] == 1


def test_list_products_with_search_filter(client: TestClient, db_session, admin_user, test_supplier):
    """6. Search filter returns matching products."""
    _create_master_product(db_session, supplier=test_supplier, name="Organic Honey", sku="HONEY-001")
    _create_master_product(db_session, supplier=test_supplier, name="White Sugar", sku="SUGAR-001")

    headers = get_auth_headers(client, admin_user.email)
    response = client.get(API, headers=headers, params={"search": "honey"})

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Organic Honey"


def test_get_product_with_assignments(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """7. GET single product includes property assignments."""
    product = _create_master_product(db_session, supplier=test_supplier)

    item = InventoryItem(
        property_id=test_property.id,
        master_product_id=product.id,
        name=product.name,
        category=product.category,
        unit=product.unit,
        supplier_id=test_supplier.id,
        par_level=30.0,
        current_stock=10.0,
    )
    db_session.add(item)
    db_session.commit()

    headers = get_auth_headers(client, admin_user.email)
    response = client.get(f"{API}/{product.id}", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["assigned_property_count"] == 1
    assert len(data["assignments"]) == 1
    assignment = data["assignments"][0]
    assert assignment["property_id"] == test_property.id
    assert assignment["property_name"] == test_property.name
    assert assignment["par_level"] == 30.0
    assert assignment["current_stock"] == 10.0


def test_update_master_product(client: TestClient, db_session, admin_user, test_supplier):
    """8. Admin can update master product fields."""
    product = _create_master_product(db_session, supplier=test_supplier)
    headers = get_auth_headers(client, admin_user.email)

    response = client.put(
        f"{API}/{product.id}",
        headers=headers,
        json={"name": "Bread Flour", "brand": "Bob's Red Mill"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Bread Flour"
    assert data["brand"] == "Bob's Red Mill"
    # Unchanged fields should remain
    assert data["category"] == "Dry Goods"


def test_update_sku_to_duplicate_fails(client: TestClient, db_session, admin_user, test_supplier):
    """9. Cannot update SKU to one that already exists on another product."""
    _create_master_product(db_session, supplier=test_supplier, sku="TAKEN-SKU", name="Product A")
    product_b = _create_master_product(
        db_session, supplier=test_supplier, sku="ORIG-SKU", name="Product B"
    )

    headers = get_auth_headers(client, admin_user.email)
    response = client.put(
        f"{API}/{product_b.id}",
        headers=headers,
        json={"sku": "TAKEN-SKU"},
    )

    assert response.status_code == 400
    assert "SKU already exists" in response.json()["detail"]


def test_delete_soft_when_linked_to_inventory(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """10. Delete is a soft delete when inventory items are linked."""
    product = _create_master_product(db_session, supplier=test_supplier)

    item = InventoryItem(
        property_id=test_property.id,
        master_product_id=product.id,
        name=product.name,
        category=product.category,
        unit=product.unit,
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=0,
    )
    db_session.add(item)
    db_session.commit()

    headers = get_auth_headers(client, admin_user.email)
    response = client.delete(f"{API}/{product.id}", headers=headers)

    assert response.status_code == 204

    # Product should still exist in DB but be inactive
    db_session.refresh(product)
    assert product.is_active is False


def test_delete_hard_when_not_linked(client: TestClient, db_session, admin_user, test_supplier):
    """11. Delete is a hard delete when no inventory items are linked."""
    product = _create_master_product(db_session, supplier=test_supplier)
    product_id = product.id

    headers = get_auth_headers(client, admin_user.email)
    response = client.delete(f"{API}/{product_id}", headers=headers)

    assert response.status_code == 204

    # Product should be gone from the DB
    deleted = db_session.query(MasterProduct).filter(MasterProduct.id == product_id).first()
    assert deleted is None


# ============== ASSIGNMENT TESTS ==============

def test_assign_to_property_creates_inventory_item(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """12. Assigning to a property creates an InventoryItem linked to the master product."""
    product = _create_master_product(db_session, supplier=test_supplier)
    headers = get_auth_headers(client, admin_user.email)

    response = client.post(
        f"{API}/{product.id}/assign",
        headers=headers,
        json={"property_ids": [test_property.id]},
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["created"]) == 1
    assert data["created"][0]["property_id"] == test_property.id

    # Verify inventory item was created
    inv_item = db_session.query(InventoryItem).filter(
        InventoryItem.master_product_id == product.id,
        InventoryItem.property_id == test_property.id,
    ).first()
    assert inv_item is not None
    assert inv_item.name == product.name
    assert inv_item.category == product.category
    assert inv_item.par_level == product.default_par_level


def test_assign_to_multiple_properties(
    client: TestClient, db_session, admin_user, test_supplier, test_property, second_property
):
    """13. Assigning to multiple properties at once."""
    product = _create_master_product(db_session, supplier=test_supplier)
    headers = get_auth_headers(client, admin_user.email)

    response = client.post(
        f"{API}/{product.id}/assign",
        headers=headers,
        json={"property_ids": [test_property.id, second_property.id]},
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["created"]) == 2
    assert len(data["skipped"]) == 0

    created_property_ids = {c["property_id"] for c in data["created"]}
    assert created_property_ids == {test_property.id, second_property.id}


def test_assign_already_assigned_property_is_skipped(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """14. Re-assigning a property that already has the product is skipped."""
    product = _create_master_product(db_session, supplier=test_supplier)
    headers = get_auth_headers(client, admin_user.email)

    # First assignment
    client.post(
        f"{API}/{product.id}/assign",
        headers=headers,
        json={"property_ids": [test_property.id]},
    )

    # Second (duplicate) assignment
    response = client.post(
        f"{API}/{product.id}/assign",
        headers=headers,
        json={"property_ids": [test_property.id]},
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["created"]) == 0
    assert len(data["skipped"]) == 1
    assert data["skipped"][0]["reason"] == "Already assigned"


def test_assign_with_par_level_override(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """15. par_level in request overrides the master product's default_par_level."""
    product = _create_master_product(
        db_session, supplier=test_supplier, default_par_level=50.0, default_order_at=20.0
    )
    headers = get_auth_headers(client, admin_user.email)

    response = client.post(
        f"{API}/{product.id}/assign",
        headers=headers,
        json={"property_ids": [test_property.id], "par_level": 100.0, "order_at": 40.0},
    )

    assert response.status_code == 200

    inv_item = db_session.query(InventoryItem).filter(
        InventoryItem.master_product_id == product.id,
        InventoryItem.property_id == test_property.id,
    ).first()
    assert inv_item is not None
    assert inv_item.par_level == 100.0
    assert inv_item.order_at == 40.0


def test_unassign_from_property(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """16. Unassigning removes the inventory item."""
    product = _create_master_product(db_session, supplier=test_supplier)
    headers = get_auth_headers(client, admin_user.email)

    # First assign
    client.post(
        f"{API}/{product.id}/assign",
        headers=headers,
        json={"property_ids": [test_property.id]},
    )

    # Then unassign
    response = client.delete(
        f"{API}/{product.id}/unassign/{test_property.id}",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["property_id"] == test_property.id

    # Verify inventory item is gone
    inv_item = db_session.query(InventoryItem).filter(
        InventoryItem.master_product_id == product.id,
        InventoryItem.property_id == test_property.id,
    ).first()
    assert inv_item is None


# ============== SYNC TESTS ==============

def test_sync_from_master_updates_inventory_item(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """17. sync-from-master updates inventory item fields from the master product."""
    product = _create_master_product(db_session, supplier=test_supplier, brand="King Arthur")

    # Create an inventory item with stale data
    inv_item = InventoryItem(
        property_id=test_property.id,
        master_product_id=product.id,
        name="Old Name",
        category="Old Category",
        brand="Old Brand",
        unit=product.unit,
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=10.0,
    )
    db_session.add(inv_item)
    db_session.commit()
    db_session.refresh(inv_item)

    headers = get_auth_headers(client, admin_user.email)
    response = client.post(
        f"{API}/sync-from-master",
        headers=headers,
        json={
            "inventory_item_ids": [inv_item.id],
            "sync_fields": ["name", "category", "brand"],
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["synced"]) == 1

    db_session.refresh(inv_item)
    assert inv_item.name == product.name
    assert inv_item.category == product.category
    assert inv_item.brand == "King Arthur"


def test_sync_all(
    client: TestClient, db_session, admin_user, test_supplier, test_property, second_property
):
    """18. sync-all updates every linked inventory item."""
    product = _create_master_product(db_session, supplier=test_supplier)

    items = []
    for prop in [test_property, second_property]:
        inv = InventoryItem(
            property_id=prop.id,
            master_product_id=product.id,
            name="Stale Name",
            category="Stale Category",
            brand="Stale Brand",
            unit="each",
            supplier_id=test_supplier.id,
            par_level=50.0,
            current_stock=0,
            is_active=True,
        )
        db_session.add(inv)
        items.append(inv)
    db_session.commit()

    headers = get_auth_headers(client, admin_user.email)
    response = client.post(f"{API}/sync-all", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["synced_count"] == 2

    for inv in items:
        db_session.refresh(inv)
        assert inv.name == product.name
        assert inv.category == product.category
        assert inv.unit == product.unit


# ============== SEED TESTS ==============

def test_seed_from_property_creates_master_products(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """19. seed-from-property creates master products from unlinked inventory items."""
    # Create unlinked, recurring inventory items
    item1 = InventoryItem(
        property_id=test_property.id,
        name="Ranch Dressing",
        category="Condiments",
        unit="bottle",
        supplier_id=test_supplier.id,
        par_level=12.0,
        order_at=4.0,
        current_stock=6.0,
        is_recurring=True,
        is_active=True,
    )
    item2 = InventoryItem(
        property_id=test_property.id,
        name="Ketchup",
        category="Condiments",
        unit="bottle",
        supplier_id=test_supplier.id,
        par_level=10.0,
        order_at=3.0,
        current_stock=5.0,
        is_recurring=True,
        is_active=True,
    )
    db_session.add_all([item1, item2])
    db_session.commit()

    headers = get_auth_headers(client, admin_user.email)
    response = client.post(
        f"{API}/seed-from-property",
        headers=headers,
        json={"property_id": test_property.id},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["created_count"] == 2
    assert data["property_name"] == test_property.name

    # Verify master products were created and items are now linked
    db_session.refresh(item1)
    db_session.refresh(item2)
    assert item1.master_product_id is not None
    assert item2.master_product_id is not None

    master1 = db_session.query(MasterProduct).filter(MasterProduct.id == item1.master_product_id).first()
    assert master1 is not None
    assert master1.name == "Ranch Dressing"
    assert master1.default_par_level == 12.0


# ============== OTHER TESTS ==============

def test_list_categories(client: TestClient, db_session, admin_user, test_supplier):
    """20. GET /categories returns distinct category names."""
    _create_master_product(db_session, supplier=test_supplier, name="Flour", sku="F1", category="Dry Goods")
    _create_master_product(db_session, supplier=test_supplier, name="Rice", sku="R1", category="Dry Goods")
    _create_master_product(db_session, supplier=test_supplier, name="Milk", sku="M1", category="Dairy")

    headers = get_auth_headers(client, admin_user.email)
    response = client.get(f"{API}/categories", headers=headers)

    assert response.status_code == 200
    categories = response.json()
    assert "Dry Goods" in categories
    assert "Dairy" in categories
    # "Dry Goods" appears twice in DB but should only be returned once (distinct)
    assert categories.count("Dry Goods") == 1


def test_list_unlinked_items(
    client: TestClient, db_session, admin_user, test_supplier, test_property
):
    """21. GET /unlinked-items returns inventory items without a master_product_id."""
    # Linked item
    product = _create_master_product(db_session, supplier=test_supplier)
    linked = InventoryItem(
        property_id=test_property.id,
        master_product_id=product.id,
        name="Linked Flour",
        category="Dry Goods",
        unit="lb",
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=25.0,
        is_active=True,
    )

    # Unlinked item
    unlinked = InventoryItem(
        property_id=test_property.id,
        master_product_id=None,
        name="Orphan Sugar",
        category="Dry Goods",
        unit="lb",
        supplier_id=test_supplier.id,
        par_level=30.0,
        current_stock=10.0,
        is_active=True,
    )

    db_session.add_all([linked, unlinked])
    db_session.commit()

    headers = get_auth_headers(client, admin_user.email)
    response = client.get(f"{API}/unlinked-items", headers=headers)

    assert response.status_code == 200
    data = response.json()
    names = [item["name"] for item in data]
    assert "Orphan Sugar" in names
    assert "Linked Flour" not in names
