from sqlalchemy import Column, Integer, String, DateTime, Text, Float, ForeignKey, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class OrderStatus(str, enum.Enum):
    DRAFT = "draft"                      # Camp worker is building the order
    SUBMITTED = "submitted"              # Camp worker submitted for review
    UNDER_REVIEW = "under_review"        # Purchasing supervisor is reviewing
    APPROVED = "approved"                # Supervisor approved, ready for ordering
    CHANGES_REQUESTED = "changes_requested"  # Supervisor requested changes
    ORDERED = "ordered"                  # Order placed with suppliers
    PARTIALLY_RECEIVED = "partially_received"  # Some items received
    RECEIVED = "received"                # All items received
    CANCELLED = "cancelled"


class OrderItemFlag(str, enum.Enum):
    LOW_STOCK = "low_stock"              # Below par level
    TREND_SUGGESTED = "trend_suggested"  # Based on usage patterns
    MANUAL = "manual"                    # Manually added by user
    CUSTOM = "custom"                    # Special one-off item not in inventory


class Order(Base):
    """
    Weekly order for a property.
    Created by camp worker, reviewed/approved by purchasing supervisor.
    """
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    order_number = Column(String(50), unique=True, nullable=False, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)

    status = Column(String(50), default=OrderStatus.DRAFT.value, nullable=False, index=True)

    # Order period
    week_of = Column(DateTime(timezone=True), nullable=True)  # Start of the week this order is for

    # Workflow tracking
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)

    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_notes = Column(Text, nullable=True)

    approved_at = Column(DateTime(timezone=True), nullable=True)
    ordered_at = Column(DateTime(timezone=True), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)

    # Totals
    estimated_total = Column(Float, default=0.0)
    actual_total = Column(Float, nullable=True)  # Updated from receipts

    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    camp_property = relationship("Property", back_populates="orders")
    created_by_user = relationship("User", back_populates="orders_created", foreign_keys=[created_by])
    reviewed_by_user = relationship("User", back_populates="orders_reviewed", foreign_keys=[reviewed_by])
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    receipts = relationship("Receipt", back_populates="order")

    @property
    def item_count(self) -> int:
        """Get the number of items in this order"""
        return len(self.items) if self.items else 0


class OrderItem(Base):
    """
    Individual item in an order.
    Can be from inventory list or a custom one-off item.
    """
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)

    # Link to inventory item (null if custom)
    inventory_item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=True)

    # For custom items not in inventory
    custom_item_name = Column(String(255), nullable=True)
    custom_item_description = Column(Text, nullable=True)

    # Supplier (can override inventory item's default supplier)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)

    # Why this item was added
    flag = Column(String(50), default=OrderItemFlag.MANUAL.value)

    # Quantities
    requested_quantity = Column(Float, nullable=False)  # What camp worker requested
    approved_quantity = Column(Float, nullable=True)    # What supervisor approved (can modify)
    received_quantity = Column(Float, nullable=True)    # What was actually received

    unit = Column(String(50), nullable=True)
    unit_price = Column(Float, nullable=True)

    # Item notes
    camp_notes = Column(Text, nullable=True)      # Notes from camp worker
    reviewer_notes = Column(Text, nullable=True)  # Notes from supervisor
    receiving_notes = Column(Text, nullable=True) # Notes when receiving (quality issues, etc.)

    # Receiving flags
    is_received = Column(Boolean, default=False)
    has_issue = Column(Boolean, default=False)  # Quality issue, missing, etc.
    issue_description = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    order = relationship("Order", back_populates="items")
    inventory_item = relationship("InventoryItem", back_populates="order_items")
    supplier = relationship("Supplier", back_populates="order_items")

    @property
    def item_name(self) -> str:
        """Get the item name whether it's from inventory or custom"""
        if self.inventory_item:
            return self.inventory_item.name
        return self.custom_item_name or "Unknown Item"

    @property
    def final_quantity(self) -> float:
        """Get the quantity to order (approved if reviewed, otherwise requested)"""
        return self.approved_quantity if self.approved_quantity is not None else self.requested_quantity

    @property
    def line_total(self) -> float:
        """Calculate line total based on final quantity and unit price"""
        qty = self.final_quantity
        price = self.unit_price or 0
        return qty * price
