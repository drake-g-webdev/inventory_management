from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    CAMP_WORKER = "camp_worker"
    PURCHASING_SUPERVISOR = "purchasing_supervisor"
    PURCHASING_TEAM = "purchasing_team"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    role = Column(String(50), default=UserRole.CAMP_WORKER.value, nullable=False)
    is_active = Column(Boolean, default=True)

    # Camp workers are assigned to a specific property
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    camp_property = relationship("Property", back_populates="users")
    orders_created = relationship("Order", back_populates="created_by_user", foreign_keys="Order.created_by")
    orders_reviewed = relationship("Order", back_populates="reviewed_by_user", foreign_keys="Order.reviewed_by")
    receipts_uploaded = relationship("Receipt", back_populates="uploaded_by_user", foreign_keys="Receipt.uploaded_by")
