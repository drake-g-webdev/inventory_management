from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime


class ReceiptLineItem(BaseModel):
    item_name: str
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total_price: Optional[float] = None
    matched_inventory_item_id: Optional[int] = None
    matched_order_item_id: Optional[int] = None


class ReceiptBase(BaseModel):
    order_id: Optional[int] = None
    supplier_id: Optional[int] = None
    receipt_date: Optional[datetime] = None
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    total: Optional[float] = None
    notes: Optional[str] = None


class ReceiptCreate(ReceiptBase):
    image_url: str


class ReceiptFromUpload(BaseModel):
    order_id: Optional[int] = None
    supplier_id: Optional[int] = None
    notes: Optional[str] = None


class ReceiptUpdate(BaseModel):
    supplier_id: Optional[int] = None
    receipt_date: Optional[datetime] = None
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    total: Optional[float] = None
    notes: Optional[str] = None
    line_items: Optional[List[ReceiptLineItem]] = None
    is_processed: Optional[bool] = None
    is_manually_verified: Optional[bool] = None


class ReceiptResponse(ReceiptBase):
    id: int
    image_url: str
    uploaded_by: Optional[int] = None
    line_items: Optional[List[Any]] = None
    confidence_score: Optional[float] = None
    is_processed: bool
    is_manually_verified: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ReceiptWithDetails(ReceiptResponse):
    order_number: Optional[str] = None
    supplier_name: Optional[str] = None
    uploaded_by_name: Optional[str] = None
    parsed_line_items: List[ReceiptLineItem] = []
    unmatched_items: List[Any] = []  # Unmatched items that can be added to inventory
    detected_supplier_name: Optional[str] = None  # AI-detected supplier name from receipt


# Unmatched item from receipt that can be added to inventory
class UnmatchedReceiptItem(BaseModel):
    item_name: str  # Name as it appears on receipt
    suggested_name: Optional[str] = None  # AI-suggested cleaned name
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total_price: Optional[float] = None
    suggested_category: Optional[str] = None


# Request schema for adding unmatched item to inventory
class AddUnmatchedToInventory(BaseModel):
    name: str  # Final name for the item
    property_id: int
    supplier_id: Optional[int] = None
    category: Optional[str] = None
    unit: str = "unit"
    unit_price: Optional[float] = None
    par_level: Optional[float] = None
    is_recurring: bool = True


# AI extraction response
class ReceiptExtractionResult(BaseModel):
    supplier_name: Optional[str] = None  # Detected supplier from receipt
    receipt_date: Optional[datetime] = None
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    total: Optional[float] = None
    line_items: List[ReceiptLineItem] = []
    unmatched_items: List[UnmatchedReceiptItem] = []  # Items not matched to order
    confidence_score: float
    raw_text: Optional[str] = None


# Financial summaries
class SupplierSpendingSummary(BaseModel):
    supplier_id: int
    supplier_name: str
    total_spent: float
    receipt_count: int
    avg_receipt_amount: float


class PropertySpendingSummary(BaseModel):
    property_id: int
    property_name: str
    total_spent: float
    receipt_count: int
    order_count: int


class SpendingByPeriod(BaseModel):
    period: str  # "2024-01", "2024-W01", etc.
    total_spent: float
    receipt_count: int
    order_count: int


class FinancialDashboard(BaseModel):
    total_spent_this_month: float
    total_spent_this_year: float
    pending_orders_total: float
    receipts_pending_verification: int
    spending_by_supplier: List[SupplierSpendingSummary]
    spending_by_property: List[PropertySpendingSummary]
    spending_trend: List[SpendingByPeriod]
