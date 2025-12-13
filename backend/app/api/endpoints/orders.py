from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import uuid
import logging

from app.core.database import get_db
from app.core.security import (
    get_current_user, require_property_access,
    require_supervisor_or_admin, require_purchasing_team
)
from app.core.email import (
    send_order_submitted_notification,
    send_order_approved_notification,
    send_order_changes_requested_notification,
    send_flagged_items_notification
)
from app.api.endpoints.notifications import create_flagged_item_notifications
from app.models.user import User, UserRole
from app.models.property import Property
from app.models.inventory import InventoryItem
from app.models.order import Order, OrderItem, OrderStatus, OrderItemFlag
from app.models.supplier import Supplier
from app.schemas.order import (
    OrderCreate, OrderUpdate, OrderResponse, OrderWithItems,
    OrderItemCreate, OrderItemUpdate, OrderItemWithDetails,
    OrderSubmitRequest, OrderReviewRequest, OrderReceiveRequest,
    AutoGenerateOrderRequest, OrderSummary, PropertyOrderSummary,
    SupplierPurchaseList, SupplierPurchaseGroup, SupplierPurchaseItem,
    FlaggedItemResponse, FlaggedItemsList
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orders", tags=["Orders"])


def generate_order_number() -> str:
    """Generate unique order number"""
    return f"ORD-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"


def calculate_order_total(order: Order) -> float:
    """Calculate estimated total for an order"""
    total = 0.0
    for item in order.items:
        qty = item.approved_quantity if item.approved_quantity is not None else item.requested_quantity
        price = item.unit_price or 0
        total += qty * price
    return total


# ============== ORDER CRUD ==============

@router.get("", response_model=List[OrderWithItems])
def list_orders(
    property_id: Optional[int] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List orders (filtered by property for camp workers)"""
    if property_id:
        require_property_access(property_id, current_user)
    elif current_user.role == UserRole.CAMP_WORKER.value:
        property_id = current_user.property_id

    query = db.query(Order)
    if property_id:
        query = query.filter(Order.property_id == property_id)
    if status:
        query = query.filter(Order.status == status)

    orders = query.order_by(Order.created_at.desc()).offset(skip).limit(limit).all()

    # Build full order data with items and related info
    result = []
    for order in orders:
        order_data = _build_order_with_items(order, db)
        result.append(order_data)
    return result


@router.get("/pending-review", response_model=List[OrderWithItems])
def list_pending_review_orders(
    current_user: User = Depends(require_supervisor_or_admin),
    db: Session = Depends(get_db)
):
    """List orders pending supervisor review"""
    orders = db.query(Order).filter(
        Order.status.in_([OrderStatus.SUBMITTED.value, OrderStatus.UNDER_REVIEW.value])
    ).order_by(Order.submitted_at).all()

    result = []
    for order in orders:
        order_data = _build_order_with_items(order, db)
        result.append(order_data)
    return result


@router.get("/ready-to-order", response_model=List[OrderWithItems])
def list_ready_to_order(
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """List approved orders ready for purchasing team"""
    orders = db.query(Order).filter(
        Order.status == OrderStatus.APPROVED.value
    ).order_by(Order.approved_at).all()

    result = []
    for order in orders:
        order_data = _build_order_with_items(order, db)
        result.append(order_data)
    return result


@router.get("/supplier-purchase-list", response_model=SupplierPurchaseList)
def get_supplier_purchase_list(
    order_ids: Optional[str] = Query(None, description="Comma-separated list of order IDs"),
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """
    Get purchase list grouped by supplier from approved orders.
    If order_ids is provided, only those orders are included.
    Otherwise, all approved orders are included.
    """
    # Parse order IDs if provided
    if order_ids:
        ids = [int(id.strip()) for id in order_ids.split(",") if id.strip()]
        orders = db.query(Order).filter(
            Order.id.in_(ids),
            Order.status == OrderStatus.APPROVED.value
        ).all()
    else:
        orders = db.query(Order).filter(
            Order.status == OrderStatus.APPROVED.value
        ).all()

    if not orders:
        return SupplierPurchaseList(suppliers=[], order_ids=[], total_orders=0, grand_total=0.0)

    # Group items by supplier
    supplier_groups: dict = {}  # supplier_id -> SupplierPurchaseGroup
    grand_total = 0.0
    order_id_list = []

    for order in orders:
        order_id_list.append(order.id)

        # Get property name
        prop = db.query(Property).filter(Property.id == order.property_id).first()
        property_name = prop.name if prop else "Unknown Property"

        for item in order.items:
            # Determine supplier
            supplier_id = item.supplier_id
            if supplier_id is None and item.inventory_item and item.inventory_item.supplier_id:
                supplier_id = item.inventory_item.supplier_id

            # Get or create supplier group
            if supplier_id not in supplier_groups:
                if supplier_id:
                    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
                    supplier_groups[supplier_id] = SupplierPurchaseGroup(
                        supplier_id=supplier_id,
                        supplier_name=supplier.name if supplier else "Unknown Supplier",
                        contact_name=supplier.contact_name if supplier else None,
                        email=supplier.email if supplier else None,
                        phone=supplier.phone if supplier else None,
                        items=[],
                        total_items=0,
                        total_value=0.0
                    )
                else:
                    # No supplier assigned - use "Unassigned" group
                    supplier_groups[None] = SupplierPurchaseGroup(
                        supplier_id=None,
                        supplier_name="Unassigned / No Supplier",
                        items=[],
                        total_items=0,
                        total_value=0.0
                    )

            # Get item name
            if item.inventory_item:
                item_name = item.inventory_item.name
            else:
                item_name = item.custom_item_name or "Custom Item"

            # Calculate quantity and price
            quantity = item.approved_quantity if item.approved_quantity is not None else item.requested_quantity
            unit_price = item.unit_price or 0
            line_total = quantity * unit_price

            # Add item to supplier group
            purchase_item = SupplierPurchaseItem(
                item_id=item.id,
                item_name=item_name,
                quantity=quantity,
                unit=item.unit or "",
                unit_price=unit_price,
                line_total=line_total,
                order_id=order.id,
                order_number=order.order_number,
                property_name=property_name
            )

            supplier_groups[supplier_id].items.append(purchase_item)
            supplier_groups[supplier_id].total_items += 1
            supplier_groups[supplier_id].total_value += line_total
            grand_total += line_total

    # Convert to list and sort by supplier name
    suppliers_list = sorted(
        supplier_groups.values(),
        key=lambda x: (x.supplier_name == "Unassigned / No Supplier", x.supplier_name)
    )

    return SupplierPurchaseList(
        suppliers=suppliers_list,
        order_ids=order_id_list,
        total_orders=len(orders),
        grand_total=grand_total
    )


@router.get("/my-orders", response_model=List[OrderWithItems])
def list_my_orders(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List orders for the current user's property"""
    if not current_user.property_id:
        return []

    orders = db.query(Order).filter(
        Order.property_id == current_user.property_id
    ).order_by(Order.created_at.desc()).all()

    # Build full order data with items and related info
    result = []
    for order in orders:
        order_data = _build_order_with_items(order, db)
        result.append(order_data)
    return result


@router.get("/{order_id}", response_model=OrderWithItems)
def get_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get order details with items"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    return _build_order_with_items(order, db)


def _build_order_with_items(order: Order, db: Session) -> OrderWithItems:
    """Helper to build order response with items"""
    order_data = OrderWithItems.model_validate(order)

    # Get property name
    prop = db.query(Property).filter(Property.id == order.property_id).first()
    order_data.property_name = prop.name if prop else None

    # Get user names
    if order.created_by_user:
        order_data.created_by_name = order.created_by_user.full_name or order.created_by_user.email
    if order.reviewed_by_user:
        order_data.reviewed_by_name = order.reviewed_by_user.full_name or order.reviewed_by_user.email

    # Build items with details and calculate totals
    order_data.items = []
    total_requested = 0.0
    total_approved = 0.0

    for item in order.items:
        item_detail = OrderItemWithDetails.model_validate(item)

        # Get item name
        if item.inventory_item:
            item_detail.item_name = item.inventory_item.name
        else:
            item_detail.item_name = item.custom_item_name or "Custom Item"

        # Get supplier name
        if item.supplier:
            item_detail.supplier_name = item.supplier.name

        # Calculate quantities
        item_detail.final_quantity = item.approved_quantity if item.approved_quantity is not None else item.requested_quantity
        item_detail.line_total = item_detail.final_quantity * (item.unit_price or 0)

        # Calculate totals for requested and approved values
        unit_price = item.unit_price or 0
        total_requested += item.requested_quantity * unit_price
        if item.approved_quantity is not None:
            total_approved += item.approved_quantity * unit_price
        else:
            total_approved += item.requested_quantity * unit_price

        order_data.items.append(item_detail)

    # Set the totals
    order_data.total_requested_value = total_requested
    order_data.total_approved_value = total_approved

    return order_data


@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    order_data: OrderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create new order (draft)"""
    require_property_access(order_data.property_id, current_user)

    order = Order(
        order_number=generate_order_number(),
        property_id=order_data.property_id,
        week_of=order_data.week_of,
        notes=order_data.notes,
        created_by=current_user.id,
        status=OrderStatus.DRAFT.value
    )
    db.add(order)
    db.flush()

    # Add items
    for item_data in order_data.items:
        order_item = OrderItem(
            order_id=order.id,
            inventory_item_id=item_data.inventory_item_id,
            custom_item_name=item_data.custom_item_name,
            custom_item_description=item_data.custom_item_description,
            supplier_id=item_data.supplier_id,
            flag=item_data.flag.value if item_data.flag else OrderItemFlag.MANUAL.value,
            requested_quantity=item_data.requested_quantity,
            unit=item_data.unit,
            unit_price=item_data.unit_price,
            camp_notes=item_data.camp_notes
        )
        db.add(order_item)

    db.commit()
    db.refresh(order)

    # Update estimated total
    order.estimated_total = calculate_order_total(order)
    db.commit()

    return order


@router.post("/auto-generate", response_model=OrderResponse)
def auto_generate_order(
    request: AutoGenerateOrderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Auto-generate order from low stock items"""
    require_property_access(request.property_id, current_user)

    # Get low stock items
    items = db.query(InventoryItem).filter(
        InventoryItem.property_id == request.property_id,
        InventoryItem.is_active == True
    ).all()

    order_items = []
    for item in items:
        suggested_qty = item.suggested_order_qty()
        if suggested_qty > 0:
            flag = OrderItemFlag.LOW_STOCK if item.is_low_stock() else OrderItemFlag.TREND_SUGGESTED
            order_items.append(OrderItemCreate(
                inventory_item_id=item.id,
                supplier_id=item.supplier_id,
                flag=flag,
                requested_quantity=suggested_qty,
                unit=item.unit,
                unit_price=item.unit_price
            ))

    if not order_items:
        raise HTTPException(
            status_code=400,
            detail="No items need to be ordered based on current stock levels"
        )

    order_data = OrderCreate(
        property_id=request.property_id,
        week_of=request.week_of,
        items=order_items
    )

    return create_order(order_data, current_user, db)


@router.put("/{order_id}", response_model=OrderResponse)
def update_order(
    order_id: int,
    order_data: OrderUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update order (only draft orders by creator)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    # Only allow updates to draft orders by creator or admin
    if order.status != OrderStatus.DRAFT.value:
        raise HTTPException(status_code=400, detail="Can only update draft orders")
    if order.created_by != current_user.id and current_user.role != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Can only update your own orders")

    update_data = order_data.model_dump(exclude_unset=True)
    if 'status' in update_data:
        del update_data['status']  # Status changes through workflow endpoints

    for key, value in update_data.items():
        setattr(order, key, value)

    db.commit()
    db.refresh(order)
    return order


@router.post("/{order_id}/items", response_model=OrderResponse)
def add_order_item(
    order_id: int,
    item_data: OrderItemCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add item to draft order"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    if order.status != OrderStatus.DRAFT.value:
        raise HTTPException(status_code=400, detail="Can only add items to draft orders")

    order_item = OrderItem(
        order_id=order.id,
        inventory_item_id=item_data.inventory_item_id,
        custom_item_name=item_data.custom_item_name,
        custom_item_description=item_data.custom_item_description,
        supplier_id=item_data.supplier_id,
        flag=item_data.flag.value if item_data.flag else OrderItemFlag.MANUAL.value,
        requested_quantity=item_data.requested_quantity,
        unit=item_data.unit,
        unit_price=item_data.unit_price,
        camp_notes=item_data.camp_notes
    )
    db.add(order_item)
    db.commit()

    order.estimated_total = calculate_order_total(order)
    db.commit()
    db.refresh(order)
    return order


@router.put("/{order_id}/items/{item_id}", response_model=OrderItemWithDetails)
def update_order_item(
    order_id: int,
    item_id: int,
    item_data: OrderItemUpdate,
    current_user: User = Depends(require_supervisor_or_admin),
    db: Session = Depends(get_db)
):
    """Update order item (supervisor can modify approved quantity and notes)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status not in [OrderStatus.SUBMITTED.value, OrderStatus.UNDER_REVIEW.value]:
        raise HTTPException(status_code=400, detail="Can only edit items on orders under review")

    item = db.query(OrderItem).filter(
        OrderItem.id == item_id,
        OrderItem.order_id == order_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")

    # Update the item - accept both field naming conventions from frontend
    qty = item_data.quantity_approved or item_data.approved_quantity
    if qty is not None:
        item.approved_quantity = qty
    notes = item_data.review_notes or item_data.reviewer_notes
    if notes is not None:
        item.reviewer_notes = notes

    # Mark order as under review if it was just submitted
    if order.status == OrderStatus.SUBMITTED.value:
        order.status = OrderStatus.UNDER_REVIEW.value

    # Recalculate order total
    order.estimated_total = calculate_order_total(order)

    db.commit()
    db.refresh(item)

    # Build response with details
    item_detail = OrderItemWithDetails.model_validate(item)
    if item.inventory_item:
        item_detail.item_name = item.inventory_item.name
    else:
        item_detail.item_name = item.custom_item_name or "Custom Item"
    if item.supplier:
        item_detail.supplier_name = item.supplier.name
    item_detail.final_quantity = item.approved_quantity if item.approved_quantity is not None else item.requested_quantity
    item_detail.line_total = item_detail.final_quantity * (item.unit_price or 0)

    return item_detail


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete draft order"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    if order.status != OrderStatus.DRAFT.value:
        raise HTTPException(status_code=400, detail="Can only delete draft orders")

    db.delete(order)
    db.commit()


# ============== ORDER WORKFLOW ==============

@router.post("/{order_id}/submit", response_model=OrderResponse)
def submit_order(
    order_id: int,
    request: OrderSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Submit order for review (camp worker)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    if order.status != OrderStatus.DRAFT.value:
        raise HTTPException(status_code=400, detail="Order already submitted")

    if len(order.items) == 0:
        raise HTTPException(status_code=400, detail="Cannot submit empty order")

    order.status = OrderStatus.SUBMITTED.value
    order.submitted_at = datetime.utcnow()
    if request.notes:
        order.notes = request.notes

    order.estimated_total = calculate_order_total(order)

    db.commit()
    db.refresh(order)

    # Send email notification to purchasing supervisors
    try:
        # Get all purchasing supervisors' emails
        logger.info(f"Looking for purchasing supervisors with role: {UserRole.PURCHASING_SUPERVISOR.value}")
        supervisors = db.query(User).filter(
            User.role == UserRole.PURCHASING_SUPERVISOR.value,
            User.is_active == True
        ).all()
        logger.info(f"Found {len(supervisors)} supervisors: {[(s.email, s.role) for s in supervisors]}")
        supervisor_emails = [s.email for s in supervisors if s.email]
        logger.info(f"Supervisor emails to notify: {supervisor_emails}")

        if supervisor_emails:
            # Get property name
            prop = db.query(Property).filter(Property.id == order.property_id).first()
            property_name = prop.name if prop else "Unknown Property"

            # Get submitter name
            submitted_by = current_user.full_name or current_user.email

            # Format week_of date
            week_of_str = order.week_of.strftime("%B %d, %Y") if order.week_of else "Not specified"

            send_order_submitted_notification(
                supervisor_emails=supervisor_emails,
                order_number=order.order_number,
                property_name=property_name,
                submitted_by=submitted_by,
                item_count=len(order.items),
                estimated_total=order.estimated_total or 0,
                week_of=week_of_str
            )
    except Exception as e:
        logger.error(f"Failed to send order submission notification: {str(e)}")

    return order


@router.post("/{order_id}/review", response_model=OrderResponse)
def review_order(
    order_id: int,
    request: OrderReviewRequest,
    current_user: User = Depends(require_supervisor_or_admin),
    db: Session = Depends(get_db)
):
    """Review submitted order (supervisor)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status not in [OrderStatus.SUBMITTED.value, OrderStatus.UNDER_REVIEW.value]:
        raise HTTPException(status_code=400, detail="Order not awaiting review")

    # Update item quantities if provided
    if request.item_updates:
        for update in request.item_updates:
            item = db.query(OrderItem).filter(
                OrderItem.id == update.get('item_id'),
                OrderItem.order_id == order_id
            ).first()
            if item:
                if 'approved_quantity' in update:
                    item.approved_quantity = update['approved_quantity']
                if 'reviewer_notes' in update:
                    item.reviewer_notes = update['reviewer_notes']

    order.reviewed_by = current_user.id
    order.reviewed_at = datetime.utcnow()
    order.review_notes = request.review_notes

    if request.action == "approve":
        order.status = OrderStatus.APPROVED.value
        order.approved_at = datetime.utcnow()
        # Set approved_quantity to requested if not modified
        for item in order.items:
            if item.approved_quantity is None:
                item.approved_quantity = item.requested_quantity
    elif request.action == "request_changes":
        order.status = OrderStatus.CHANGES_REQUESTED.value
    elif request.action == "reject":
        order.status = OrderStatus.CANCELLED.value

    order.estimated_total = calculate_order_total(order)

    db.commit()
    db.refresh(order)

    # Send email notification to the camp worker who created the order
    try:
        if order.created_by_user and order.created_by_user.email:
            # Get property name
            prop = db.query(Property).filter(Property.id == order.property_id).first()
            property_name = prop.name if prop else "Unknown Property"

            # Get reviewer name
            reviewed_by = current_user.full_name or current_user.email

            if request.action == "approve":
                send_order_approved_notification(
                    worker_email=order.created_by_user.email,
                    order_number=order.order_number,
                    property_name=property_name,
                    approved_by=reviewed_by,
                    review_notes=request.review_notes
                )
            elif request.action == "request_changes":
                send_order_changes_requested_notification(
                    worker_email=order.created_by_user.email,
                    order_number=order.order_number,
                    property_name=property_name,
                    reviewed_by=reviewed_by,
                    review_notes=request.review_notes or "Please review your order."
                )
    except Exception as e:
        logger.error(f"Failed to send order review notification: {str(e)}")

    return order


@router.post("/{order_id}/resubmit", response_model=OrderResponse)
def resubmit_order(
    order_id: int,
    request: OrderSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Resubmit order after changes were requested (camp worker)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    # Only allow resubmit from CHANGES_REQUESTED or DRAFT status
    if order.status not in [OrderStatus.CHANGES_REQUESTED.value, OrderStatus.DRAFT.value]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resubmit order with status '{order.status}'. Order must be in 'changes_requested' or 'draft' status."
        )

    if len(order.items) == 0:
        raise HTTPException(status_code=400, detail="Cannot submit empty order")

    # Reset approval quantities to allow fresh review
    for item in order.items:
        item.approved_quantity = None
        item.reviewer_notes = None

    order.status = OrderStatus.SUBMITTED.value
    order.submitted_at = datetime.utcnow()
    order.reviewed_by = None
    order.reviewed_at = None
    order.review_notes = None
    if request.notes:
        order.notes = request.notes

    order.estimated_total = calculate_order_total(order)

    db.commit()
    db.refresh(order)

    # Send email notification to purchasing supervisors
    try:
        supervisors = db.query(User).filter(
            User.role == UserRole.PURCHASING_SUPERVISOR.value,
            User.is_active == True
        ).all()
        supervisor_emails = [s.email for s in supervisors if s.email]

        if supervisor_emails:
            prop = db.query(Property).filter(Property.id == order.property_id).first()
            property_name = prop.name if prop else "Unknown Property"
            submitted_by = current_user.full_name or current_user.email
            week_of_str = order.week_of.strftime("%B %d, %Y") if order.week_of else "Not specified"

            send_order_submitted_notification(
                supervisor_emails=supervisor_emails,
                order_number=order.order_number,
                property_name=property_name,
                submitted_by=submitted_by,
                item_count=len(order.items),
                estimated_total=order.estimated_total or 0,
                week_of=week_of_str
            )
    except Exception as e:
        logger.error(f"Failed to send order resubmission notification: {str(e)}")

    return order


@router.post("/{order_id}/mark-ordered", response_model=OrderResponse)
def mark_order_ordered(
    order_id: int,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Mark order as ordered (purchasing team)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status != OrderStatus.APPROVED.value:
        raise HTTPException(status_code=400, detail="Order not approved")

    order.status = OrderStatus.ORDERED.value
    order.ordered_at = datetime.utcnow()

    db.commit()
    db.refresh(order)
    return order


@router.post("/{order_id}/receive", response_model=OrderResponse)
def receive_order_items(
    order_id: int,
    request: OrderReceiveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark items as received"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    if order.status not in [OrderStatus.ORDERED.value, OrderStatus.PARTIALLY_RECEIVED.value]:
        raise HTTPException(status_code=400, detail="Order not ready for receiving")

    # Track flagged items for notification
    flagged_items = []

    for item_req in request.items:
        item = db.query(OrderItem).filter(
            OrderItem.id == item_req.item_id,
            OrderItem.order_id == order_id
        ).first()
        if item:
            item.received_quantity = item_req.received_quantity
            item.is_received = True
            item.has_issue = item_req.has_issue
            item.issue_description = item_req.issue_description
            item.receiving_notes = item_req.receiving_notes

            # Track flagged items
            if item_req.has_issue:
                item_name = item.inventory_item.name if item.inventory_item else item.custom_item_name or "Unknown Item"
                flagged_items.append({
                    'item_name': item_name,
                    'issue_description': item_req.issue_description or 'No description provided',
                    'order_item_id': item.id
                })

            # Update inventory stock if linked to inventory item
            if item.inventory_item:
                item.inventory_item.current_stock = (item.inventory_item.current_stock or 0) + item_req.received_quantity

    # Check if all items received
    all_received = all(i.is_received for i in order.items)
    if all_received:
        order.status = OrderStatus.RECEIVED.value
        order.received_at = datetime.utcnow()
    else:
        order.status = OrderStatus.PARTIALLY_RECEIVED.value

    db.commit()
    db.refresh(order)

    # Send notifications if items were flagged
    if flagged_items:
        # Get property name
        prop = db.query(Property).filter(Property.id == order.property_id).first()
        property_name = prop.name if prop else "Unknown Property"

        # Get purchasing team emails
        purchasing_users = db.query(User).filter(
            User.is_active == True,
            User.role.in_([UserRole.PURCHASING_SUPERVISOR.value, UserRole.PURCHASING_TEAM.value])
        ).all()
        team_emails = [u.email for u in purchasing_users if u.email]

        # Send email notification
        if team_emails:
            try:
                send_flagged_items_notification(
                    team_emails=team_emails,
                    order_number=order.order_number,
                    property_name=property_name,
                    flagged_by=current_user.full_name or current_user.email,
                    flagged_items=flagged_items
                )
            except Exception as e:
                logging.error(f"Failed to send flagged items email: {e}")

        # Create in-app notifications
        try:
            create_flagged_item_notifications(
                db=db,
                order_id=order.id,
                order_number=order.order_number,
                property_name=property_name,
                flagged_items=flagged_items,
                flagged_by_name=current_user.full_name or current_user.email
            )
        except Exception as e:
            logging.error(f"Failed to create in-app notifications: {e}")

    return order


# ============== FLAGGED ITEMS ==============

@router.get("/flagged-items", response_model=FlaggedItemsList)
def get_flagged_items(
    property_id: Optional[int] = None,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """
    Get all items that were flagged with issues during receiving.
    For purchasing team dashboard to see quality/delivery issues.
    Example: 'Yukon River Camp flagged Cilantro: "Cilantro was wilted and slimy when it arrived"'
    """
    # Query order items that have issues
    query = db.query(OrderItem).filter(
        OrderItem.has_issue == True,
        OrderItem.is_received == True
    )

    # Filter by property if specified
    if property_id:
        query = query.join(Order).filter(Order.property_id == property_id)

    flagged_items = query.order_by(OrderItem.updated_at.desc()).all()

    result = []
    for item in flagged_items:
        # Get related order and property info
        order = db.query(Order).filter(Order.id == item.order_id).first()
        if not order:
            continue

        prop = db.query(Property).filter(Property.id == order.property_id).first()
        property_name = prop.name if prop else "Unknown Property"

        # Get item name
        if item.inventory_item:
            item_name = item.inventory_item.name
        else:
            item_name = item.custom_item_name or "Unknown Item"

        # Get who created the order (who flagged the item)
        flagged_by = None
        if order.created_by_user:
            flagged_by = order.created_by_user.full_name or order.created_by_user.email

        result.append(FlaggedItemResponse(
            item_id=item.id,
            item_name=item_name,
            order_id=order.id,
            order_number=order.order_number,
            property_id=order.property_id,
            property_name=property_name,
            received_quantity=item.received_quantity or 0,
            approved_quantity=item.approved_quantity,
            has_issue=item.has_issue,
            issue_description=item.issue_description,
            receiving_notes=item.receiving_notes,
            received_at=order.received_at or item.updated_at,
            flagged_by_name=flagged_by
        ))

    return FlaggedItemsList(
        items=result,
        total_count=len(result)
    )


# ============== ORDER SUMMARIES ==============

@router.get("/summary/by-property", response_model=List[PropertyOrderSummary])
def get_orders_by_property(
    current_user: User = Depends(require_supervisor_or_admin),
    db: Session = Depends(get_db)
):
    """Get order summary by property"""
    properties = db.query(Property).filter(Property.is_active == True).all()

    result = []
    for prop in properties:
        pending_orders = len([o for o in prop.orders if o.status in [
            OrderStatus.DRAFT.value, OrderStatus.SUBMITTED.value,
            OrderStatus.UNDER_REVIEW.value, OrderStatus.APPROVED.value
        ]])

        total_estimated = sum(
            o.estimated_total or 0
            for o in prop.orders
            if o.status in [OrderStatus.SUBMITTED.value, OrderStatus.UNDER_REVIEW.value, OrderStatus.APPROVED.value]
        )

        last_order = max((o.created_at for o in prop.orders), default=None)

        result.append(PropertyOrderSummary(
            property_id=prop.id,
            property_name=prop.name,
            property_code=prop.code,
            pending_orders=pending_orders,
            total_estimated=total_estimated,
            last_order_date=last_order
        ))

    return result
