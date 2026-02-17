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

    # Link to master product (optional - for organization-wide products)
    master_product_id = Column(Integer, ForeignKey("master_products.id"), nullable=True, index=True)

    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True, index=True)  # e.g., "Dairy", "Produce", "Protein"
    subcategory = Column(String(100), nullable=True, index=True)  # e.g., "BIB", "Cans/Bottles", "Dry"
    brand = Column(String(255), nullable=True)  # Preferred brand
    qty = Column(String(50), nullable=True)  # Product size/quantity e.g., "50#", "5 Gal"
    product_notes = Column(Text, nullable=True)  # Purchasing notes (e.g., "individually wrapped")

    # Supplier info
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)

    # Unit and quantity info
    unit = Column(String(50), nullable=False, default="unit")  # Inventory/counting unit: box, bottle, etc.
    pack_size = Column(Float, nullable=True)  # e.g., 24 for a case of 24
    pack_unit = Column(String(50), nullable=True)  # e.g., "oz" for each item in the case

    # Order unit conversion (for when ordering unit differs from counting unit)
    order_unit = Column(String(50), nullable=True)  # e.g., "case" when counting by "box"
    units_per_order_unit = Column(Float, nullable=True, default=1.0)  # e.g., 8 boxes per case

    # Pricing
    unit_price = Column(Float, nullable=True)  # Price per unit (case, gallon, etc.)

    # Par level - when to reorder
    par_level = Column(Float, nullable=True)  # Target stock level to order back up to
    order_at = Column(Float, nullable=True)  # Threshold at which to trigger reorder

    # Current stock (updated after inventory counts)
    current_stock = Column(Float, default=0.0)

    # Usage tracking - average weekly usage calculated from history
    avg_weekly_usage = Column(Float, nullable=True)

    # For printable list ordering
    sort_order = Column(Integer, default=0)
    last_sorted_at = Column(DateTime(timezone=True), nullable=True)  # When item was last included in AI sort

    # Seasonal availability - per camp (midnight_sun, aurora, year_round)
    seasonal_availability = Column(String(50), nullable=True, default="year_round")

    # Whether this item appears on recurring inventory printout sheets
    # One-off items are stored but won't appear on the printout
    is_recurring = Column(Boolean, default=True)

    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    camp_property = relationship("Property", back_populates="inventory_items")
    supplier = relationship("Supplier", back_populates="inventory_items")
    master_product = relationship("MasterProduct", back_populates="inventory_items")
    inventory_counts = relationship("InventoryCountItem", back_populates="inventory_item")
    order_items = relationship("OrderItem", back_populates="inventory_item")
    receipt_aliases = relationship("ReceiptCodeAlias", back_populates="inventory_item", cascade="all, delete-orphan")

    def is_low_stock(self) -> bool:
        """Check if item is at or below order-at threshold"""
        threshold = self.order_at if self.order_at is not None else self.par_level
        if threshold is None:
            return False
        return (self.current_stock or 0) <= threshold

    def suggested_order_qty(self) -> float:
        """
        Suggest order quantity in ORDER UNITS based on usage and par level.
        Only suggests ordering when stock is at or below order_at threshold.
        Orders enough to bring stock back up to par_level.
        Returns quantity in order units (e.g., cases), rounded up to whole units.
        """
        # Determine the trigger threshold (order_at, falling back to par_level)
        threshold = self.order_at if self.order_at is not None else self.par_level

        # Only suggest ordering if we're at or below the threshold
        if threshold is None:
            return 0
        if (self.current_stock or 0) > threshold:
            return 0

        # Calculate needed quantity in inventory units (target is par_level)
        if self.avg_weekly_usage and self.par_level:
            needed_inventory_units = self.par_level - (self.current_stock or 0) + self.avg_weekly_usage
        elif self.par_level:
            needed_inventory_units = self.par_level - (self.current_stock or 0)
        else:
            return 0

        needed_inventory_units = max(0, needed_inventory_units)

        if needed_inventory_units == 0:
            return 0

        # Convert to order units if conversion is set
        units_per_order = self.units_per_order_unit or 1.0
        if units_per_order > 0:
            import math
            order_qty = math.ceil(needed_inventory_units / units_per_order)
            return order_qty

        return needed_inventory_units

    def get_effective_order_unit(self) -> str:
        """Get the unit used for ordering (falls back to inventory unit if not set)"""
        return self.order_unit or self.unit

    def get_units_per_order_unit(self) -> float:
        """Get conversion factor (defaults to 1 if not set)"""
        return self.units_per_order_unit or 1.0


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


class ReceiptCodeAlias(Base):
    """
    Maps receipt codes/names to inventory items.
    Stores supplier-specific receipt codes that should match to a particular inventory item.
    For example: "KS FREE N CL" from Costco -> "Laundry Detergent" inventory item
    """
    __tablename__ = "receipt_code_aliases"

    id = Column(Integer, primary_key=True, index=True)
    inventory_item_id = Column(Integer, ForeignKey("inventory_items.id"), nullable=False, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)

    # The code/name as it appears on the receipt
    receipt_code = Column(String(255), nullable=False, index=True)

    # Price from this supplier (can differ between suppliers)
    unit_price = Column(Float, nullable=True)

    # When this alias was last seen on a receipt
    last_seen = Column(DateTime(timezone=True), nullable=True)

    # How many times this alias has been used
    match_count = Column(Integer, default=0)

    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    inventory_item = relationship("InventoryItem", back_populates="receipt_aliases")
    supplier = relationship("Supplier", back_populates="receipt_aliases")
