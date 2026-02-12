from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class MasterProductBase(BaseModel):
    name: str
    sku: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    seasonal_availability: Optional[str] = "year_round"  # midnight_sun, aurora, year_round
    description: Optional[str] = None
    brand: Optional[str] = None
    qty: Optional[str] = None  # Product size e.g., "50#", "5 Gal"
    product_notes: Optional[str] = None
    supplier_id: Optional[int] = None
    unit: str = "unit"
    order_unit: Optional[str] = None
    units_per_order_unit: Optional[float] = 1.0
    unit_price: Optional[float] = None


class MasterProductCreate(MasterProductBase):
    pass


class MasterProductUpdate(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    seasonal_availability: Optional[str] = None
    description: Optional[str] = None
    brand: Optional[str] = None
    qty: Optional[str] = None
    product_notes: Optional[str] = None
    supplier_id: Optional[int] = None
    unit: Optional[str] = None
    order_unit: Optional[str] = None
    units_per_order_unit: Optional[float] = None
    unit_price: Optional[float] = None
    is_active: Optional[bool] = None


class MasterProductResponse(MasterProductBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    supplier_name: Optional[str] = None
    assigned_property_count: int = 0  # Number of properties using this product

    model_config = ConfigDict(from_attributes=True)


class MasterProductWithAssignments(MasterProductResponse):
    """Extended response with assignment details"""
    assignments: List["PropertyAssignment"] = []


class PropertyAssignment(BaseModel):
    """Shows which properties have this master product"""
    property_id: int
    property_name: str
    property_code: str
    inventory_item_id: int
    current_stock: float
    par_level: Optional[float] = None
    order_at: Optional[float] = None
    is_synced: bool = True  # Whether property item matches master


class AssignMasterProductRequest(BaseModel):
    """Request to assign a master product to properties"""
    property_ids: List[int]


class SyncFromMasterRequest(BaseModel):
    """Request to sync property items from master"""
    inventory_item_ids: List[int]
    sync_fields: List[str] = ["name", "category", "subcategory", "brand", "qty", "product_notes", "supplier_id", "unit", "order_unit", "units_per_order_unit", "unit_price"]


class SeedFromPropertyRequest(BaseModel):
    """Request to create master products from existing property inventory"""
    property_id: int
    item_ids: Optional[List[int]] = None  # If None, seed all items


class CSVUploadResponse(BaseModel):
    """Response from CSV upload"""
    created_count: int
    updated_count: int
    error_count: int
    errors: List[str] = []


# Update forward reference
MasterProductWithAssignments.model_rebuild()
