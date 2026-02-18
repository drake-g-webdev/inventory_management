from sqlalchemy import Column, Integer, String, DateTime, Text, Float, ForeignKey, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class MasterProduct(Base):
    """
    Organization-wide master product template.
    Used as source of truth for products that can be assigned to multiple properties.
    """
    __tablename__ = "master_products"

    id = Column(Integer, primary_key=True, index=True)

    # Product identification
    name = Column(String(255), nullable=False, index=True)
    sku = Column(String(100), nullable=True, unique=True, index=True)  # Optional SKU for tracking

    # Categorization
    category = Column(String(100), nullable=True, index=True)
    subcategory = Column(String(100), nullable=True)
    seasonal_availability = Column(String(50), nullable=True, default="year_round")  # midnight_sun, aurora, year_round

    # Product details
    description = Column(Text, nullable=True)
    brand = Column(String(255), nullable=True)  # Preferred brand
    qty = Column(String(50), nullable=True)  # Product size/quantity e.g., "50#", "5 Gal"
    product_notes = Column(Text, nullable=True)  # Purchasing notes (e.g., "individually wrapped")

    # Default supplier
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)

    # Unit configuration
    unit = Column(String(50), nullable=False, default="unit")  # Inventory/counting unit
    order_unit = Column(String(50), nullable=True)  # Order unit (e.g., "case" when counting by "box")
    units_per_order_unit = Column(Float, nullable=True, default=1.0)  # Conversion factor

    # Pricing
    unit_price = Column(Float, nullable=True)  # Default price per unit

    # Default par level suggestion
    default_par_level = Column(Float, nullable=True)
    default_order_at = Column(Float, nullable=True)  # Default threshold to trigger reorder

    # Status
    is_active = Column(Boolean, default=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    supplier = relationship("Supplier", back_populates="master_products")
    inventory_items = relationship("InventoryItem", back_populates="master_product")

    def __repr__(self):
        return f"<MasterProduct(id={self.id}, name='{self.name}')>"


class ProductCategory(Base):
    """
    Custom product categories and subcategories.
    Supplements the hardcoded defaults to allow admin to organize products flexibly.
    parent_name is null for top-level categories, or the category name for subcategories.
    """
    __tablename__ = "product_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    parent_name = Column(String(100), nullable=True, index=True)  # null = category, non-null = subcategory
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
