from sqlalchemy import Column, Integer, String, DateTime, Text, Float, ForeignKey, Boolean, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Receipt(Base):
    """
    Receipt uploaded by purchasing team.
    AI analyzes the receipt image and extracts line items for financial tracking.
    """
    __tablename__ = "receipts"

    id = Column(Integer, primary_key=True, index=True)

    # Link to order and supplier
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)

    # Receipt image
    image_url = Column(String(500), nullable=False)

    # Extracted data
    receipt_date = Column(DateTime(timezone=True), nullable=True)
    receipt_number = Column(String(100), nullable=True)
    subtotal = Column(Float, nullable=True)
    tax = Column(Float, nullable=True)
    total = Column(Float, nullable=True)

    # AI extracted line items stored as JSON
    # Format: [{"name": "item", "quantity": 1, "unit_price": 10.00, "total": 10.00}, ...]
    line_items = Column(JSON, nullable=True)

    # Processing status
    is_processed = Column(Boolean, default=False)
    processing_error = Column(Text, nullable=True)
    confidence_score = Column(Float, nullable=True)  # AI confidence in extraction

    # Manual corrections
    is_manually_verified = Column(Boolean, default=False)
    verified_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)

    # Who uploaded it
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    order = relationship("Order", back_populates="receipts")
    supplier = relationship("Supplier", back_populates="receipts")
    uploaded_by_user = relationship("User", back_populates="receipts_uploaded", foreign_keys=[uploaded_by])
