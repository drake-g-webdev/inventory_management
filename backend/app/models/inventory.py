from sqlalchemy import Column, Integer, String, DateTime, Text, Float, ForeignKey, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class UnitType(str, enum.Enum):
    CASE = "case"
    GALLON = "gallon"
    LB = "lb"
    OZ = "oz"
    UNIT = "unit"
    COUNT = "count"
    BOX = "box"
    BAG = "bag"
    BOTTLE = "bottle"
    CAN = "can"
    JAR = "jar"
    PACK = "pack"
    ROLL = "roll"
    OTHER = "other"


class InventoryItem(Base):
    """
    Property-specific inventory item.
    Each property has its own inventory list with items, suppliers, and par levels.
    """
    __tablename__ = "inventory_items"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)

    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True, index=True)  # e.g., "Dairy", "Produce", "Protein"
    brand = Column(String(255), nullable=True)

    # Supplier info
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)

    # Unit and quantity info
    unit = Column(String(50), nullable=False, default="unit")  # case, gallon, lb, unit, etc.
    pack_size = Column(Float, nullable=True)  # e.g., 24 for a case of 24
    pack_unit = Column(String(50), nullable=True)  # e.g., "oz" for each item in the case

    # Pricing
    unit_price = Column(Float, nullable=True)  # Price per unit (case, gallon, etc.)

    # Par level - when to reorder
    par_level = Column(Float, nullable=True)  # Minimum stock level before flagging for reorder

    # Current stock (updated after inventory counts)
    current_stock = Column(Float, default=0.0)

    # Usage tracking - average weekly usage calculated from history
    avg_weekly_usage = Column(Float, nullable=True)

    # For printable list ordering
    sort_order = Column(Integer, default=0)

    # Whether this item appears on recurring inventory printout sheets
    # One-off items are stored but won't appear on the printout
    is_recurring = Column(Boolean, default=True)

    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    camp_property = relationship("Property", back_populates="inventory_items")
    supplier = relationship("Supplier", back_populates="inventory_items")
    inventory_counts = relationship("InventoryCountItem", back_populates="inventory_item")
    order_items = relationship("OrderItem", back_populates="inventory_item")

    def is_low_stock(self) -> bool:
        """Check if item is below par level"""
        if self.par_level is None:
            return False
        return (self.current_stock or 0) < self.par_level

    def suggested_order_qty(self) -> float:
        """Suggest order quantity based on usage and par level"""
        if self.avg_weekly_usage and self.par_level:
            # Order enough for 1 week plus buffer to par level
            needed = self.par_level - (self.current_stock or 0) + self.avg_weekly_usage
            return max(0, needed)
        elif self.par_level:
            return max(0, self.par_level - (self.current_stock or 0))
        return 0


class InventoryCount(Base):
    """
    Represents an inventory count session for a property.
    Can be created manually or from AI vision analysis of a photo.
    """
    __tablename__ = "inventory_counts"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)

    count_date = Column(DateTime(timezone=True), server_default=func.now())
    counted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)

    # If uploaded via photo
    source_image_url = Column(String(500), nullable=True)
    is_from_vision = Column(Boolean, default=False)

    is_finalized = Column(Boolean, default=False)  # Lock after review

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    camp_property = relationship("Property", back_populates="inventory_counts")
    items = relationship("InventoryCountItem", back_populates="inventory_count", cascade="all, delete-orphan")


class InventoryCountItem(Base):
    """Individual item counts within an inventory count session"""
    __tablename__ = "inventory_count_items"

    id = Column(Integer, primary_key=True, index=True)
    inventory_count_id = Column(Integer, ForeignKey("inventory_counts.id"), nullable=False)
    inventory_item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False)

    quantity = Column(Float, nullable=False)
    notes = Column(Text, nullable=True)

    # For AI vision - confidence score
    confidence = Column(Float, nullable=True)  # 0.0 to 1.0

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    inventory_count = relationship("InventoryCount", back_populates="items")
    inventory_item = relationship("InventoryItem", back_populates="inventory_counts")
