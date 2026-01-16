from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.user import User, UserRole
from app.models.property import Property
from app.schemas.property import PropertyCreate, PropertyUpdate, PropertyResponse, PropertyWithStats

router = APIRouter(prefix="/properties", tags=["Properties"])


@router.get("/", response_model=List[PropertyResponse])
def list_properties(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max records to return"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all properties (filtered by access for camp workers)"""
    query = db.query(Property).filter(Property.is_active == True)

    # Camp workers only see their assigned property
    if current_user.role == UserRole.CAMP_WORKER.value:
        if current_user.property_id:
            query = query.filter(Property.id == current_user.property_id)
        else:
            return []

    return query.offset(skip).limit(limit).all()


@router.get("/{property_id}", response_model=PropertyWithStats)
def get_property(
    property_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get property details with stats"""
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    # Check access
    if current_user.role == UserRole.CAMP_WORKER.value:
        if current_user.property_id != property_id:
            raise HTTPException(status_code=403, detail="Access denied to this property")

    response = PropertyWithStats.model_validate(prop)
    response.user_count = len([u for u in prop.users if u.is_active])
    response.inventory_item_count = len([i for i in prop.inventory_items if i.is_active])
    response.pending_orders_count = len([o for o in prop.orders if o.status in ['draft', 'submitted', 'under_review', 'approved']])

    return response


@router.post("/", response_model=PropertyResponse, status_code=status.HTTP_201_CREATED)
def create_property(
    prop_data: PropertyCreate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Create a new property (admin only)"""
    existing = db.query(Property).filter(Property.code == prop_data.code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Property code already exists"
        )

    prop = Property(**prop_data.model_dump())
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return prop


@router.put("/{property_id}", response_model=PropertyResponse)
def update_property(
    property_id: int,
    prop_data: PropertyUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Update a property (admin only)"""
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    if prop_data.code and prop_data.code != prop.code:
        existing = db.query(Property).filter(Property.code == prop_data.code).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Property code already exists"
            )

    update_data = prop_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(prop, key, value)

    db.commit()
    db.refresh(prop)
    return prop


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property(
    property_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Soft delete a property (admin only)"""
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    prop.is_active = False
    db.commit()
