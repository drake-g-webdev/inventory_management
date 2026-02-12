from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
from app.models.order import OrderStatus, OrderItemFlag


class OrderItemBase(BaseModel):
    inventory_item_id: Optional[int] = None
    custom_item_name: Optional[str] = None
    custom_item_description: Optional[str] = None
    supplier_id: Optional[int] = None
    flag: OrderItemFlag = OrderItemFlag.MANUAL
    requested_quantity: float
    unit: Optional[str] = None
    unit_price: Optional[float] = None
    camp_notes: Optional[str] = None


class OrderItemCreate(OrderItemBase):
    pass


class OrderItemUpdate(BaseModel):
    # Accept both quantity_approved (from frontend) and approved_quantity
    quantity_approved: Optional[float] = Field(default=None, alias="quantity_approved")
    approved_quantity: Optional[float] = None
    received_quantity: Optional[float] = None
    unit_price: Optional[float] = None
    reviewer_notes: Optional[str] = None
    review_notes: Optional[str] = None  # Accept both field names from frontend
    receiving_notes: Optional[str] = None
    is_received: Optional[bool] = None
    has_issue: Optional[bool] = None
    issue_description: Optional[str] = None
    supplier_id: Optional[int] = None  # Allow changing supplier during review

    model_config = ConfigDict(populate_by_name=True)


class OrderItemResponse(OrderItemBase):
    id: int
    order_id: int
    approved_quantity: Optional[float] = None
    received_quantity: Optional[float] = None
    reviewer_notes: Optional[str] = None
    receiving_notes: Optional[str] = None
    is_received: bool
    has_issue: bool
    issue_description: Optional[str] = None
    issue_photo_url: Optional[str] = None
    shortage_dismissed: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class OrderItemWithDetails(OrderItemResponse):
    item_name: str
    category: Optional[str] = None
    qty: Optional[str] = None
    supplier_name: Optional[str] = None
    par_level: Optional[float] = None
    order_at: Optional[float] = None
    current_stock: Optional[float] = None
    final_quantity: float
    line_total: float


class OrderBase(BaseModel):
    property_id: int
    week_of: Optional[datetime] = None
    notes: Optional[str] = None


class OrderCreate(OrderBase):
    items: List[OrderItemCreate] = []


class OrderUpdate(BaseModel):
    week_of: Optional[datetime] = None
    notes: Optional[str] = None
    status: Optional[OrderStatus] = None


class OrderResponse(BaseModel):
    id: int
    order_number: str
    property_id: int
    status: str
    week_of: Optional[datetime] = None
    created_by: Optional[int] = None
    submitted_at: Optional[datetime] = None
    reviewed_by: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    approved_at: Optional[datetime] = None
    ordered_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    estimated_total: float
    actual_total: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    item_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class OrderWithItems(OrderResponse):
    items: List[OrderItemWithDetails] = []
    property_name: Optional[str] = None
    created_by_name: Optional[str] = None
    reviewed_by_name: Optional[str] = None
    total_requested_value: Optional[float] = None
    total_approved_value: Optional[float] = None


# Workflow actions
class OrderSubmitRequest(BaseModel):
    notes: Optional[str] = None


class OrderReviewRequest(BaseModel):
    action: str  # "approve", "request_changes", "reject"
    review_notes: Optional[str] = None
    item_updates: Optional[List[dict]] = None  # Updates to individual items


class OrderMarkOrderedRequest(BaseModel):
    ordered_at: Optional[datetime] = None


class OrderReceiveItemRequest(BaseModel):
    item_id: int
    received_quantity: float
    has_issue: bool = False
    issue_description: Optional[str] = None
    issue_photo_url: Optional[str] = None
    receiving_notes: Optional[str] = None


class OrderReceiveRequest(BaseModel):
    items: List[OrderReceiveItemRequest]
    finalize: bool = False  # When False, saves progress without updating inventory


# Auto-generate order from low stock
class AutoGenerateOrderRequest(BaseModel):
    property_id: int
    include_trend_suggestions: bool = True
    week_of: Optional[datetime] = None


# Order summaries for dashboards
class OrderSummary(BaseModel):
    total_orders: int
    draft_count: int
    submitted_count: int
    under_review_count: int
    approved_count: int
    ordered_count: int
    received_count: int


class PropertyOrderSummary(BaseModel):
    property_id: int
    property_name: str
    property_code: str
    pending_orders: int
    total_estimated: float
    last_order_date: Optional[datetime] = None


# Supplier purchase list for approved orders
class SupplierPurchaseItem(BaseModel):
    item_id: int
    item_name: str
    category: Optional[str] = None
    brand: Optional[str] = None  # Preferred brand
    qty: Optional[str] = None  # Product size e.g., "50#", "5 Gal"
    product_notes: Optional[str] = None  # Purchasing notes
    quantity: float
    unit: str
    unit_price: Optional[float] = None
    line_total: Optional[float] = None
    order_id: int
    order_number: str
    property_name: str


class SupplierPurchaseGroup(BaseModel):
    supplier_id: Optional[int] = None
    supplier_name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    items: List[SupplierPurchaseItem] = []
    total_items: int = 0
    total_value: float = 0.0


class SupplierPurchaseList(BaseModel):
    suppliers: List[SupplierPurchaseGroup] = []
    order_ids: List[int] = []
    total_orders: int = 0
    grand_total: float = 0.0


# Flagged items for purchasing team dashboard
class FlaggedItemResponse(BaseModel):
    item_id: int
    item_name: str
    order_id: int
    order_number: str
    property_id: int
    property_name: str
    received_quantity: float
    approved_quantity: Optional[float] = None
    has_issue: bool
    issue_description: Optional[str] = None
    issue_photo_url: Optional[str] = None
    receiving_notes: Optional[str] = None
    received_at: Optional[datetime] = None
    flagged_by_name: Optional[str] = None


class FlaggedItemsList(BaseModel):
    items: List[FlaggedItemResponse] = []
    total_count: int = 0


# Unreceived items from previous orders (aggregated by inventory item)
class UnreceivedItemResponse(BaseModel):
    inventory_item_id: Optional[int] = None
    item_name: str
    total_shortage: float  # Sum of shortages across all orders
    unit: Optional[str] = None
    unit_price: Optional[float] = None
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    property_id: Optional[int] = None
    property_name: Optional[str] = None
    # Source order item IDs for dismissing
    source_order_item_ids: List[int] = []
    # Most recent order info
    latest_order_number: Optional[str] = None
    latest_week_of: Optional[datetime] = None
    order_count: int = 1  # How many orders this shortage spans


class UnreceivedItemsList(BaseModel):
    items: List[UnreceivedItemResponse] = []
    total_count: int = 0
    total_shortage_value: float = 0.0


class DismissShortageRequest(BaseModel):
    order_item_ids: List[int]
