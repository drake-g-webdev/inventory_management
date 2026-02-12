from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional

from app.core.database import get_db
from app.core.security import get_current_user, require_admin, require_supervisor_or_admin
from app.models.user import User
from app.models.supplier import Supplier
from app.models.inventory import InventoryItem
from app.models.order import OrderItem
from app.schemas.supplier import SupplierCreate, SupplierUpdate, SupplierResponse, SupplierWithStats

router = APIRouter(prefix="/suppliers", tags=["Suppliers"])


@router.get("", response_model=List[SupplierResponse])
def list_suppliers(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all suppliers"""
    query = db.query(Supplier).filter(Supplier.is_active == True)

    if search:
        query = query.filter(Supplier.name.ilike(f"%{search}%"))

    return query.order_by(Supplier.name).offset(skip).limit(limit).all()


@router.get("/{supplier_id}", response_model=SupplierWithStats)
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get supplier details with stats"""
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    response = SupplierWithStats.model_validate(supplier)
    response.item_count = db.query(func.count(InventoryItem.id)).filter(
        InventoryItem.supplier_id == supplier_id
    ).scalar() or 0
    response.total_orders = db.query(func.count(OrderItem.id)).filter(
        OrderItem.supplier_id == supplier_id
    ).scalar() or 0
    response.total_spent = 0.0

    return response


@router.post("", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
def create_supplier(
    supplier_data: SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_admin)
):
    """Create a new supplier (supervisor or admin)"""
    supplier = Supplier(**supplier_data.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.put("/{supplier_id}", response_model=SupplierResponse)
def update_supplier(
    supplier_id: int,
    supplier_data: SupplierUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor_or_admin)
):
    """Update a supplier (supervisor or admin)"""
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    update_data = supplier_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(supplier, key, value)

    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Soft delete a supplier (admin only)"""
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    supplier.is_active = False
    db.commit()
