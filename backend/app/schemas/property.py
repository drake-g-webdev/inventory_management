from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class PropertyBase(BaseModel):
    name: str
    code: str
    address: Optional[str] = None


class PropertyCreate(PropertyBase):
    pass


class PropertyUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None


class PropertyResponse(PropertyBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PropertyWithStats(PropertyResponse):
    user_count: int = 0
    inventory_item_count: int = 0
    pending_orders_count: int = 0
