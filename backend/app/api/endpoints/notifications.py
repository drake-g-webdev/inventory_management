from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.models import User, Notification, NotificationType
from app.schemas.notification import (
    NotificationResponse,
    NotificationList,
    MarkReadRequest,
)
from app.core.security import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationList)
def get_my_notifications(
    limit: int = Query(50, ge=1, le=200, description="Max notifications to return"),
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get notifications for the current user"""
    query = db.query(Notification).filter(Notification.user_id == current_user.id)

    if unread_only:
        query = query.filter(Notification.is_read == False)

    notifications = query.order_by(Notification.created_at.desc()).limit(limit).all()

    # Get unread count
    unread_count = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).count()

    return NotificationList(
        notifications=notifications,
        unread_count=unread_count
    )


@router.get("/unread-count")
def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get the count of unread notifications"""
    count = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).count()
    return {"unread_count": count}


@router.post("/mark-read")
def mark_notifications_read(
    request: MarkReadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark specific notifications as read"""
    db.query(Notification).filter(
        Notification.id.in_(request.notification_ids),
        Notification.user_id == current_user.id
    ).update({
        Notification.is_read: True,
        Notification.read_at: datetime.utcnow()
    }, synchronize_session=False)

    db.commit()
    return {"success": True, "marked_count": len(request.notification_ids)}


@router.post("/mark-all-read")
def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark all notifications as read for current user"""
    result = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).update({
        Notification.is_read: True,
        Notification.read_at: datetime.utcnow()
    }, synchronize_session=False)

    db.commit()
    return {"success": True, "marked_count": result}


@router.delete("/{notification_id}")
def delete_notification(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a notification"""
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id
    ).first()

    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    db.delete(notification)
    db.commit()
    return {"success": True}


# Helper function to create notifications for purchasing team
def create_flagged_item_notifications(
    db: Session,
    order_id: int,
    order_number: str,
    property_name: str,
    flagged_items: List[dict],  # List of {item_name, issue_description, order_item_id}
    flagged_by_name: str
):
    """
    Create notifications for all purchasing team members when items are flagged.
    Returns list of created notifications.
    """
    from app.models import UserRole

    # Get all purchasing supervisors and team members
    purchasing_users = db.query(User).filter(
        User.is_active == True,
        User.role.in_([UserRole.PURCHASING_SUPERVISOR.value, UserRole.PURCHASING_TEAM.value])
    ).all()

    notifications = []
    for user in purchasing_users:
        for item in flagged_items:
            notification = Notification(
                user_id=user.id,
                type=NotificationType.FLAGGED_ITEM.value,
                title=f"Item Flagged: {item['item_name']}",
                message=f"{property_name}: {item['issue_description']}",
                link="/orders/flagged-items",
                order_id=order_id,
                order_item_id=item.get('order_item_id')
            )
            db.add(notification)
            notifications.append(notification)

    db.commit()
    return notifications
