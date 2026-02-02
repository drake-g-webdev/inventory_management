from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
import csv
import io

from app.core.database import get_db
from app.core.security import require_admin
from app.models.user import User
from app.models.master_product import MasterProduct
from app.models.inventory import InventoryItem
from app.models.property import Property
from app.models.supplier import Supplier
from app.schemas.master_product import (
    MasterProductCreate, MasterProductUpdate, MasterProductResponse,
    MasterProductWithAssignments, PropertyAssignment,
    AssignMasterProductRequest, SyncFromMasterRequest,
    SeedFromPropertyRequest, CSVUploadResponse
)

router = APIRouter(prefix="/master-products", tags=["Master Products"])


# ============== CRUD OPERATIONS ==============

@router.get("", response_model=List[MasterProductResponse])
def list_master_products(
    category: Optional[str] = None,
    supplier_id: Optional[int] = None,
    search: Optional[str] = None,
    include_inactive: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=1000),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """List all master products (admin only)"""
    query = db.query(MasterProduct)

    if not include_inactive:
        query = query.filter(MasterProduct.is_active == True)

    if category:
        query = query.filter(MasterProduct.category == category)

    if supplier_id:
        query = query.filter(MasterProduct.supplier_id == supplier_id)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (MasterProduct.name.ilike(search_term)) |
            (MasterProduct.sku.ilike(search_term)) |
            (MasterProduct.brand.ilike(search_term))
        )

    products = query.order_by(MasterProduct.category, MasterProduct.name).offset(skip).limit(limit).all()

    # Build response with supplier names and assignment counts
    result = []
    for product in products:
        # Count properties using this product
        assignment_count = db.query(InventoryItem).filter(
            InventoryItem.master_product_id == product.id
        ).count()

        product_data = MasterProductResponse(
            id=product.id,
            name=product.name,
            sku=product.sku,
            category=product.category,
            subcategory=product.subcategory,
            description=product.description,
            brand=product.brand,
            product_notes=product.product_notes,
            supplier_id=product.supplier_id,
            supplier_name=product.supplier.name if product.supplier else None,
            unit=product.unit,
            order_unit=product.order_unit,
            units_per_order_unit=product.units_per_order_unit,
            unit_price=product.unit_price,
            default_par_level=product.default_par_level,
            is_active=product.is_active,
            created_at=product.created_at,
            updated_at=product.updated_at,
            assigned_property_count=assignment_count
        )
        result.append(product_data)

    return result


@router.get("/categories")
def list_master_product_categories(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get list of unique categories from master products"""
    categories = db.query(MasterProduct.category).filter(
        MasterProduct.category.isnot(None),
        MasterProduct.is_active == True
    ).distinct().all()
    return [c[0] for c in categories if c[0]]


@router.get("/{product_id}", response_model=MasterProductWithAssignments)
def get_master_product(
    product_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get a single master product with assignment details"""
    product = db.query(MasterProduct).filter(MasterProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Master product not found")

    # Get all inventory items linked to this master product
    linked_items = db.query(InventoryItem).filter(
        InventoryItem.master_product_id == product_id
    ).all()

    assignments = []
    for item in linked_items:
        # Check if item is synced with master
        is_synced = (
            item.name == product.name and
            item.category == product.category and
            item.brand == product.brand and
            item.supplier_id == product.supplier_id and
            item.unit == product.unit
        )

        assignments.append(PropertyAssignment(
            property_id=item.property_id,
            property_name=item.camp_property.name if item.camp_property else "Unknown",
            property_code=item.camp_property.code if item.camp_property else "???",
            inventory_item_id=item.id,
            current_stock=item.current_stock or 0,
            par_level=item.par_level,
            is_synced=is_synced
        ))

    return MasterProductWithAssignments(
        id=product.id,
        name=product.name,
        sku=product.sku,
        category=product.category,
        subcategory=product.subcategory,
        description=product.description,
        brand=product.brand,
        product_notes=product.product_notes,
        supplier_id=product.supplier_id,
        supplier_name=product.supplier.name if product.supplier else None,
        unit=product.unit,
        order_unit=product.order_unit,
        units_per_order_unit=product.units_per_order_unit,
        unit_price=product.unit_price,
        default_par_level=product.default_par_level,
        is_active=product.is_active,
        created_at=product.created_at,
        updated_at=product.updated_at,
        assigned_property_count=len(assignments),
        assignments=assignments
    )


@router.post("", response_model=MasterProductResponse, status_code=status.HTTP_201_CREATED)
def create_master_product(
    product_data: MasterProductCreate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Create a new master product"""
    # Check for duplicate SKU
    if product_data.sku:
        existing = db.query(MasterProduct).filter(MasterProduct.sku == product_data.sku).first()
        if existing:
            raise HTTPException(status_code=400, detail="SKU already exists")

    product = MasterProduct(**product_data.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)

    return MasterProductResponse(
        id=product.id,
        name=product.name,
        sku=product.sku,
        category=product.category,
        subcategory=product.subcategory,
        description=product.description,
        brand=product.brand,
        product_notes=product.product_notes,
        supplier_id=product.supplier_id,
        supplier_name=product.supplier.name if product.supplier else None,
        unit=product.unit,
        order_unit=product.order_unit,
        units_per_order_unit=product.units_per_order_unit,
        unit_price=product.unit_price,
        default_par_level=product.default_par_level,
        is_active=product.is_active,
        created_at=product.created_at,
        updated_at=product.updated_at,
        assigned_property_count=0
    )


@router.put("/{product_id}", response_model=MasterProductResponse)
def update_master_product(
    product_id: int,
    product_data: MasterProductUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Update a master product"""
    product = db.query(MasterProduct).filter(MasterProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Master product not found")

    # Check for duplicate SKU
    if product_data.sku and product_data.sku != product.sku:
        existing = db.query(MasterProduct).filter(
            MasterProduct.sku == product_data.sku,
            MasterProduct.id != product_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="SKU already exists")

    # Update fields
    update_data = product_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(product, field, value)

    db.commit()
    db.refresh(product)

    # Count assignments
    assignment_count = db.query(InventoryItem).filter(
        InventoryItem.master_product_id == product_id
    ).count()

    return MasterProductResponse(
        id=product.id,
        name=product.name,
        sku=product.sku,
        category=product.category,
        subcategory=product.subcategory,
        description=product.description,
        brand=product.brand,
        product_notes=product.product_notes,
        supplier_id=product.supplier_id,
        supplier_name=product.supplier.name if product.supplier else None,
        unit=product.unit,
        order_unit=product.order_unit,
        units_per_order_unit=product.units_per_order_unit,
        unit_price=product.unit_price,
        default_par_level=product.default_par_level,
        is_active=product.is_active,
        created_at=product.created_at,
        updated_at=product.updated_at,
        assigned_property_count=assignment_count
    )


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_master_product(
    product_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Delete a master product (soft delete by setting inactive)"""
    product = db.query(MasterProduct).filter(MasterProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Master product not found")

    # Check if any inventory items are linked
    linked_count = db.query(InventoryItem).filter(
        InventoryItem.master_product_id == product_id
    ).count()

    if linked_count > 0:
        # Soft delete - mark as inactive
        product.is_active = False
        db.commit()
    else:
        # Hard delete if no links
        db.delete(product)
        db.commit()


# ============== ASSIGNMENT OPERATIONS ==============

@router.post("/{product_id}/assign")
def assign_to_properties(
    product_id: int,
    request: AssignMasterProductRequest,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Assign a master product to one or more properties"""
    product = db.query(MasterProduct).filter(MasterProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Master product not found")

    created = []
    skipped = []

    for property_id in request.property_ids:
        # Check property exists
        prop = db.query(Property).filter(Property.id == property_id).first()
        if not prop:
            skipped.append({"property_id": property_id, "reason": "Property not found"})
            continue

        # Check if already assigned
        existing = db.query(InventoryItem).filter(
            InventoryItem.property_id == property_id,
            InventoryItem.master_product_id == product_id
        ).first()

        if existing:
            skipped.append({"property_id": property_id, "reason": "Already assigned", "inventory_item_id": existing.id})
            continue

        # Create new inventory item linked to master
        inventory_item = InventoryItem(
            property_id=property_id,
            master_product_id=product_id,
            name=product.name,
            description=product.description,
            category=product.category,
            subcategory=product.subcategory,
            brand=product.brand,
            product_notes=product.product_notes,
            supplier_id=product.supplier_id,
            unit=product.unit,
            order_unit=product.order_unit,
            units_per_order_unit=product.units_per_order_unit,
            unit_price=product.unit_price,
            par_level=request.par_level or product.default_par_level,
            current_stock=0,
            is_recurring=True,
            is_active=True
        )
        db.add(inventory_item)
        db.flush()
        created.append({
            "property_id": property_id,
            "property_name": prop.name,
            "inventory_item_id": inventory_item.id
        })

    db.commit()

    return {
        "message": f"Assigned to {len(created)} properties",
        "created": created,
        "skipped": skipped
    }


@router.post("/sync-from-master")
def sync_items_from_master(
    request: SyncFromMasterRequest,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Sync property inventory items with their master product data"""
    synced = []
    errors = []

    for item_id in request.inventory_item_ids:
        item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
        if not item:
            errors.append({"item_id": item_id, "error": "Item not found"})
            continue

        if not item.master_product_id:
            errors.append({"item_id": item_id, "error": "Not linked to master product"})
            continue

        master = item.master_product
        if not master:
            errors.append({"item_id": item_id, "error": "Master product not found"})
            continue

        # Sync specified fields
        for field in request.sync_fields:
            if hasattr(master, field) and hasattr(item, field):
                setattr(item, field, getattr(master, field))

        synced.append({
            "item_id": item_id,
            "property_id": item.property_id,
            "master_product_id": master.id
        })

    db.commit()

    return {
        "message": f"Synced {len(synced)} items",
        "synced": synced,
        "errors": errors
    }


# ============== SEEDING OPERATIONS ==============

@router.post("/seed-from-property")
def seed_from_property(
    request: SeedFromPropertyRequest,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Create master products from existing property inventory items"""
    # Get property
    prop = db.query(Property).filter(Property.id == request.property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    # Get items to seed (only recurring items - non-recurring are one-time purchases)
    query = db.query(InventoryItem).filter(
        InventoryItem.property_id == request.property_id,
        InventoryItem.is_active == True,
        InventoryItem.is_recurring == True,  # Only seed recurring items to master
        InventoryItem.master_product_id.is_(None)  # Not already linked
    )

    if request.item_ids:
        query = query.filter(InventoryItem.id.in_(request.item_ids))

    items = query.all()

    created = []
    linked = []

    for item in items:
        # Check if a similar master product already exists (by name)
        existing_master = db.query(MasterProduct).filter(
            MasterProduct.name.ilike(item.name)
        ).first()

        if existing_master:
            # Link to existing master product
            item.master_product_id = existing_master.id
            linked.append({
                "item_id": item.id,
                "item_name": item.name,
                "master_product_id": existing_master.id,
                "action": "linked"
            })
        else:
            # Create new master product
            master = MasterProduct(
                name=item.name,
                category=item.category,
                subcategory=item.subcategory,
                description=item.description,
                brand=item.brand,
                product_notes=item.product_notes,
                supplier_id=item.supplier_id,
                unit=item.unit,
                order_unit=item.order_unit,
                units_per_order_unit=item.units_per_order_unit,
                unit_price=item.unit_price,
                default_par_level=item.par_level,
                is_active=True
            )
            db.add(master)
            db.flush()

            # Link the original item to the new master
            item.master_product_id = master.id

            created.append({
                "item_id": item.id,
                "item_name": item.name,
                "master_product_id": master.id,
                "action": "created"
            })

    db.commit()

    return {
        "message": f"Processed {len(items)} items from {prop.name}",
        "property_name": prop.name,
        "created_count": len(created),
        "linked_count": len(linked),
        "items": created + linked
    }


@router.delete("/cleanup-non-recurring")
def cleanup_non_recurring_master_products(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Remove master products that were incorrectly seeded from non-recurring items.
    - Deletes master products only linked to non-recurring items
    - Unlinks non-recurring items from master products that also have recurring items
    """
    # Find all master products linked to non-recurring inventory items
    non_recurring_items = db.query(InventoryItem).filter(
        InventoryItem.master_product_id.isnot(None),
        InventoryItem.is_recurring == False
    ).all()

    unlinked_count = 0
    deleted_master_ids = set()
    deleted_names = []

    for item in non_recurring_items:
        master_id = item.master_product_id
        if master_id in deleted_master_ids:
            continue

        # Check if this master product has any recurring items
        has_recurring = db.query(InventoryItem).filter(
            InventoryItem.master_product_id == master_id,
            InventoryItem.is_recurring == True
        ).first() is not None

        if has_recurring:
            # Just unlink this non-recurring item
            item.master_product_id = None
            unlinked_count += 1
        else:
            # No recurring items - delete the master product entirely
            master = db.query(MasterProduct).filter(MasterProduct.id == master_id).first()
            if master:
                deleted_names.append(master.name)
                # First unlink all items from this master
                db.query(InventoryItem).filter(
                    InventoryItem.master_product_id == master_id
                ).update({"master_product_id": None})
                # Then delete the master product
                db.delete(master)
                deleted_master_ids.add(master_id)

    db.commit()

    return {
        "message": f"Cleanup complete",
        "deleted_master_products": len(deleted_master_ids),
        "deleted_names": deleted_names,
        "unlinked_items": unlinked_count
    }


@router.post("/upload-csv", response_model=CSVUploadResponse)
async def upload_master_products_csv(
    file: UploadFile = File(...),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Upload CSV to create/update master products"""
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    content = await file.read()
    decoded = content.decode('utf-8')
    reader = csv.DictReader(io.StringIO(decoded))

    created_count = 0
    updated_count = 0
    errors = []

    # Get supplier lookup
    suppliers = {s.name.lower(): s.id for s in db.query(Supplier).all()}

    for row_num, row in enumerate(reader, start=2):
        try:
            name = row.get('name', '').strip()
            if not name:
                errors.append(f"Row {row_num}: Name is required")
                continue

            # Look up supplier by name
            supplier_name = row.get('supplier_name', '').strip().lower()
            supplier_id = suppliers.get(supplier_name) if supplier_name else None

            # Check if exists by SKU or name
            sku = row.get('sku', '').strip() or None
            existing = None
            if sku:
                existing = db.query(MasterProduct).filter(MasterProduct.sku == sku).first()
            if not existing:
                existing = db.query(MasterProduct).filter(
                    MasterProduct.name.ilike(name)
                ).first()

            if existing:
                # Update existing
                existing.name = name
                existing.sku = sku
                existing.category = row.get('category', '').strip() or existing.category
                existing.subcategory = row.get('subcategory', '').strip() or existing.subcategory
                existing.description = row.get('description', '').strip() or existing.description
                existing.brand = row.get('brand', '').strip() or existing.brand
                existing.product_notes = row.get('product_notes', '').strip() or existing.product_notes
                existing.supplier_id = supplier_id or existing.supplier_id
                existing.unit = row.get('unit', '').strip() or existing.unit
                existing.order_unit = row.get('order_unit', '').strip() or existing.order_unit

                try:
                    existing.units_per_order_unit = float(row.get('units_per_order_unit', '')) if row.get('units_per_order_unit', '').strip() else existing.units_per_order_unit
                except ValueError:
                    pass

                try:
                    existing.unit_price = float(row.get('unit_price', '')) if row.get('unit_price', '').strip() else existing.unit_price
                except ValueError:
                    pass

                try:
                    existing.default_par_level = float(row.get('default_par_level', '')) if row.get('default_par_level', '').strip() else existing.default_par_level
                except ValueError:
                    pass

                updated_count += 1
            else:
                # Create new
                unit_price = None
                try:
                    unit_price = float(row.get('unit_price', '')) if row.get('unit_price', '').strip() else None
                except ValueError:
                    pass

                units_per_order = None
                try:
                    units_per_order = float(row.get('units_per_order_unit', '')) if row.get('units_per_order_unit', '').strip() else None
                except ValueError:
                    pass

                default_par = None
                try:
                    default_par = float(row.get('default_par_level', '')) if row.get('default_par_level', '').strip() else None
                except ValueError:
                    pass

                product = MasterProduct(
                    name=name,
                    sku=sku,
                    category=row.get('category', '').strip() or None,
                    subcategory=row.get('subcategory', '').strip() or None,
                    description=row.get('description', '').strip() or None,
                    brand=row.get('brand', '').strip() or None,
                    product_notes=row.get('product_notes', '').strip() or None,
                    supplier_id=supplier_id,
                    unit=row.get('unit', '').strip() or 'unit',
                    order_unit=row.get('order_unit', '').strip() or None,
                    units_per_order_unit=units_per_order,
                    unit_price=unit_price,
                    default_par_level=default_par,
                    is_active=True
                )
                db.add(product)
                created_count += 1

        except Exception as e:
            errors.append(f"Row {row_num}: {str(e)}")

    db.commit()

    return CSVUploadResponse(
        created_count=created_count,
        updated_count=updated_count,
        error_count=len(errors),
        errors=errors[:20]  # Limit errors returned
    )


@router.get("/unlinked-items")
def list_unlinked_inventory_items(
    property_id: Optional[int] = None,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """List inventory items not linked to any master product"""
    query = db.query(InventoryItem).filter(
        InventoryItem.master_product_id.is_(None),
        InventoryItem.is_active == True
    )

    if property_id:
        query = query.filter(InventoryItem.property_id == property_id)

    items = query.order_by(InventoryItem.property_id, InventoryItem.category, InventoryItem.name).all()

    result = []
    for item in items:
        result.append({
            "id": item.id,
            "name": item.name,
            "category": item.category,
            "unit": item.unit,
            "property_id": item.property_id,
            "property_name": item.camp_property.name if item.camp_property else None,
            "property_code": item.camp_property.code if item.camp_property else None
        })

    return result
