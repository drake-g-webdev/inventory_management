from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class NotificationBase(BaseModel):
    type: str
    title: str
    message: Optional[str] = None
    link: Optional[str] = None


class NotificationCreate(NotificationBase):
    user_id: int
    order_id: Optional[int] = None
    order_item_id: Optional[int] = None


class NotificationResponse(NotificationBase):
    id: int
    user_id: int
    order_id: Optional[int] = None
    order_item_id: Optional[int] = None
    is_read: bool
    created_at: datetime
    read_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class NotificationList(BaseModel):
    notifications: List[NotificationResponse]
    unread_count: int


class MarkReadRequest(BaseModel):
    notification_ids: List[int]
