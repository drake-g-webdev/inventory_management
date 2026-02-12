from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class NotificationType(str, enum.Enum):
    FLAGGED_ITEM = "flagged_item"
    ORDER_SUBMITTED = "order_submitted"
    ORDER_APPROVED = "order_approved"
    ORDER_CHANGES_REQUESTED = "order_changes_requested"
    ORDER_RECEIVED = "order_received"


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    link = Column(String(255), nullable=True)  # Link to navigate to when clicked

    # Reference to related entities
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    order_item_id = Column(Integer, ForeignKey("order_items.id"), nullable=True)

    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    read_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", backref="notifications")
    order = relationship("Order", backref="notifications")
    order_item = relationship("OrderItem", backref="notifications")
