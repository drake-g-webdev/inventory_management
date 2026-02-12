from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class InventoryItemBase(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    brand: Optional[str] = None  # Preferred brand
    qty: Optional[str] = None  # Product size e.g., "50#", "5 Gal"
    product_notes: Optional[str] = None  # Purchasing notes (e.g., "individually wrapped")
    supplier_id: Optional[int] = None
    unit: str = "unit"  # Inventory/counting unit
    pack_size: Optional[float] = None
    pack_unit: Optional[str] = None
    order_unit: Optional[str] = None  # Ordering unit (e.g., "case" when counting by "box")
    units_per_order_unit: Optional[float] = None  # Conversion factor (e.g., 8 boxes per case)
    unit_price: Optional[float] = None
    par_level: Optional[float] = None
    order_at: Optional[float] = None
    current_stock: float = 0.0  # Allow setting initial stock on creation
    sort_order: int = 0
    is_recurring: bool = True  # Whether item appears on inventory printout sheets


class InventoryItemCreate(InventoryItemBase):
    property_id: int


class InventoryItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    brand: Optional[str] = None  # Preferred brand
    qty: Optional[str] = None  # Product size e.g., "50#", "5 Gal"
    product_notes: Optional[str] = None  # Purchasing notes
    supplier_id: Optional[int] = None
    unit: Optional[str] = None
    pack_size: Optional[float] = None
    pack_unit: Optional[str] = None
    order_unit: Optional[str] = None
    units_per_order_unit: Optional[float] = None
    unit_price: Optional[float] = None
    par_level: Optional[float] = None
    order_at: Optional[float] = None
    current_stock: Optional[float] = None
    avg_weekly_usage: Optional[float] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None
    is_recurring: Optional[bool] = None


class InventoryItemResponse(InventoryItemBase):
    id: int
    property_id: int
    current_stock: float
    avg_weekly_usage: Optional[float] = None
    is_active: bool
    is_recurring: bool = True
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class InventoryItemWithStatus(InventoryItemResponse):
    is_low_stock: bool = False
    suggested_order_qty: float = 0.0  # In order units
    supplier_name: Optional[str] = None
    subcategory: Optional[str] = None
    effective_order_unit: Optional[str] = None  # Order unit or falls back to inventory unit


# Inventory Count schemas
class InventoryCountItemCreate(BaseModel):
    inventory_item_id: int
    quantity: float
    notes: Optional[str] = None
    confidence: Optional[float] = None


class InventoryCountItemResponse(BaseModel):
    id: int
    inventory_item_id: int
    quantity: float
    notes: Optional[str] = None
    confidence: Optional[float] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InventoryCountItemWithDetails(InventoryCountItemResponse):
    item_name: str
    item_category: Optional[str] = None
    item_unit: str


class InventoryCountCreate(BaseModel):
    property_id: int
    notes: Optional[str] = None
    items: List[InventoryCountItemCreate] = []


class InventoryCountFromVision(BaseModel):
    property_id: int
    image_url: str
    notes: Optional[str] = None


class InventoryCountUpdate(BaseModel):
    notes: Optional[str] = None
    is_finalized: Optional[bool] = None


class InventoryCountResponse(BaseModel):
    id: int
    property_id: int
    count_date: datetime
    counted_by: Optional[int] = None
    notes: Optional[str] = None
    source_image_url: Optional[str] = None
    is_from_vision: bool
    is_finalized: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class InventoryCountWithItems(InventoryCountResponse):
    items: List[InventoryCountItemWithDetails] = []
    counted_by_name: Optional[str] = None


# Printable inventory list
class PrintableInventoryItem(BaseModel):
    name: str
    category: Optional[str] = None
    unit: str
    par_level: Optional[float] = None
    current_stock: float
    count_field: str = "_______"  # For manual entry


class PrintableInventoryList(BaseModel):
    property_name: str
    property_code: str
    generated_at: datetime
    items: List[PrintableInventoryItem]
