from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Property(Base):
    """Represents a camp/property location"""
    __tablename__ = "properties"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    code = Column(String(50), unique=True, nullable=False)  # Short code like "CAMP1"
    address = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    users = relationship("User", back_populates="camp_property")
    inventory_items = relationship("InventoryItem", back_populates="camp_property")
    orders = relationship("Order", back_populates="camp_property")
    inventory_counts = relationship("InventoryCount", back_populates="camp_property")
