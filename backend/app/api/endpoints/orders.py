from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime
import uuid
import logging
import os

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
    OrderItemCreate, OrderItemUpdate, OrderItemResponse, OrderItemWithDetails,
    OrderSubmitRequest, OrderReviewRequest, OrderReceiveRequest,
    AutoGenerateOrderRequest, OrderSummary, PropertyOrderSummary,
    SupplierPurchaseList, SupplierPurchaseGroup, SupplierPurchaseItem,
    FlaggedItemResponse, FlaggedItemsList,
    UnreceivedItemResponse, UnreceivedItemsList, DismissShortageRequest
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orders", tags=["Orders"])


def generate_order_number(property_code: str) -> str:
    """Generate order number with property code and date (e.g., YRC-20251215)"""
    return f"{property_code}-{datetime.utcnow().strftime('%Y%m%d')}"


def calculate_order_total(order: Order) -> float:
    """Calculate estimated total for an order"""
    total = 0.0
    for item in order.items:
        qty = item.approved_quantity if item.approved_quantity is not None else item.requested_quantity
        price = item.unit_price or 0
        total += qty * price
    return total


def _get_order_query_with_eager_loading(db: Session):
    """
    Create a query with eager loading to prevent N+1 queries.
    Loads: items, inventory_item, supplier, created_by_user, reviewed_by_user, camp_property
    """
    return db.query(Order).options(
        joinedload(Order.items).joinedload(OrderItem.inventory_item).joinedload(InventoryItem.supplier),
        joinedload(Order.items).joinedload(OrderItem.supplier),
        joinedload(Order.created_by_user),
        joinedload(Order.reviewed_by_user),
        joinedload(Order.camp_property)
    )


# ============== ORDER CRUD ==============

@router.get("", response_model=List[OrderWithItems])
def list_orders(
    property_id: Optional[int] = None,
    status: Optional[str] = None,
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=500, description="Max records to return"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List orders (filtered by property for camp workers)"""
    if property_id:
        require_property_access(property_id, current_user)
    elif current_user.role == UserRole.CAMP_WORKER.value:
        property_id = current_user.property_id

    # Use eager loading to prevent N+1 queries
    query = _get_order_query_with_eager_loading(db)
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
    # Use eager loading to prevent N+1 queries
    orders = _get_order_query_with_eager_loading(db).filter(
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
    # Use eager loading to prevent N+1 queries
    orders = _get_order_query_with_eager_loading(db).filter(
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
    Get purchase list grouped by supplier from approved/ordered orders.
    If order_ids is provided, only those orders are included (approved, ordered, partially_received, received).
    Otherwise, only approved orders are included (for creating purchase lists).
    """
    # Statuses that can be viewed in a purchase list
    viewable_statuses = [
        OrderStatus.APPROVED.value,
        OrderStatus.ORDERED.value,
        OrderStatus.PARTIALLY_RECEIVED.value,
        OrderStatus.RECEIVED.value
    ]

    # Build query with eager loading to prevent N+1 queries
    # Loads: items, items.inventory_item, items.supplier, camp_property
    base_query = db.query(Order).options(
        joinedload(Order.items).joinedload(OrderItem.inventory_item),
        joinedload(Order.items).joinedload(OrderItem.supplier),
        joinedload(Order.camp_property)
    )

    # Parse order IDs if provided
    if order_ids:
        ids = [int(id.strip()) for id in order_ids.split(",") if id.strip()]
        # When viewing specific orders, allow any viewable status
        orders = base_query.filter(
            Order.id.in_(ids),
            Order.status.in_(viewable_statuses)
        ).all()
    else:
        # When getting all orders (for aggregated purchase list), only show approved
        orders = base_query.filter(
            Order.status == OrderStatus.APPROVED.value
        ).all()

    if not orders:
        return SupplierPurchaseList(suppliers=[], order_ids=[], total_orders=0, grand_total=0.0)

    # Pre-load all suppliers that might be referenced (avoids N+1 queries)
    supplier_ids = set()
    for order in orders:
        for item in order.items:
            if item.supplier_id:
                supplier_ids.add(item.supplier_id)
            elif item.inventory_item and item.inventory_item.supplier_id:
                supplier_ids.add(item.inventory_item.supplier_id)

    suppliers_map = {}
    if supplier_ids:
        suppliers = db.query(Supplier).filter(Supplier.id.in_(supplier_ids)).all()
        suppliers_map = {s.id: s for s in suppliers}

    # Group items by supplier
    supplier_groups: dict = {}  # supplier_id -> SupplierPurchaseGroup
    grand_total = 0.0
    order_id_list = []

    for order in orders:
        order_id_list.append(order.id)

        # Use eagerly loaded camp_property (no additional query)
        property_name = order.camp_property.name if order.camp_property else "Unknown Property"

        for item in order.items:
            # Determine supplier (using eagerly loaded relationships)
            supplier_id = item.supplier_id
            if supplier_id is None and item.inventory_item and item.inventory_item.supplier_id:
                supplier_id = item.inventory_item.supplier_id

            # Get or create supplier group (using pre-loaded suppliers_map)
            if supplier_id not in supplier_groups:
                if supplier_id:
                    supplier = suppliers_map.get(supplier_id)
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

            # Get item details
            if item.inventory_item:
                item_name = item.inventory_item.name
                item_category = item.inventory_item.category
                item_brand = item.inventory_item.brand
                item_qty = item.inventory_item.qty
                item_product_notes = item.inventory_item.product_notes
            else:
                item_name = item.custom_item_name or "Custom Item"
                item_category = None
                item_brand = None
                item_qty = None
                item_product_notes = None

            # Calculate quantity and price
            quantity = item.approved_quantity if item.approved_quantity is not None else item.requested_quantity

            # Skip items with 0 or no approved quantity
            if quantity is None or quantity <= 0:
                continue

            unit_price = item.unit_price or 0
            line_total = quantity * unit_price

            # Add item to supplier group
            purchase_item = SupplierPurchaseItem(
                item_id=item.id,
                item_name=item_name,
                category=item_category,
                brand=item_brand,
                qty=item_qty,
                product_notes=item_product_notes,
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

    # Use eager loading to prevent N+1 queries
    orders = _get_order_query_with_eager_loading(db).filter(
        Order.property_id == current_user.property_id
    ).order_by(Order.created_at.desc()).all()

    # Build full order data with items and related info
    result = []
    for order in orders:
        order_data = _build_order_with_items(order, db)
        result.append(order_data)
    return result


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
    Shows items as soon as they're flagged (saved), not just when finalized.
    Example: 'Yukon River Camp flagged Cilantro: "Cilantro was wilted and slimy when it arrived"'
    """
    # Query order items with eager loading to prevent N+1 queries
    # Loads: order, order.camp_property, order.created_by_user, inventory_item
    # Shows flagged items regardless of is_received status (appears on save, not just finalize)
    query = db.query(OrderItem).options(
        joinedload(OrderItem.order).joinedload(Order.camp_property),
        joinedload(OrderItem.order).joinedload(Order.created_by_user),
        joinedload(OrderItem.inventory_item)
    ).filter(
        OrderItem.has_issue == True
    )

    # Filter by property if specified
    if property_id:
        query = query.join(Order, OrderItem.order_id == Order.id).filter(Order.property_id == property_id)

    flagged_items = query.order_by(OrderItem.updated_at.desc()).all()

    result = []
    for item in flagged_items:
        # Use eagerly loaded relationships (no additional queries)
        order = item.order
        if not order:
            continue

        property_name = order.camp_property.name if order.camp_property else "Unknown Property"

        # Get item name from eagerly loaded inventory_item
        if item.inventory_item:
            item_name = item.inventory_item.name
        else:
            item_name = item.custom_item_name or "Unknown Item"

        # Get who created the order (who flagged the item) - eagerly loaded
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
            issue_photo_url=item.issue_photo_url,
            receiving_notes=item.receiving_notes,
            received_at=order.received_at or item.updated_at,
            flagged_by_name=flagged_by
        ))

    return FlaggedItemsList(
        items=result,
        total_count=len(result)
    )


@router.post("/items/{item_id}/resolve-flag")
def resolve_flagged_item(
    item_id: int,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """
    Resolve a flagged item by clearing the issue flag.
    Used by purchasing team to mark flagged items as addressed.
    """
    item = db.query(OrderItem).filter(OrderItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")

    if not item.has_issue:
        raise HTTPException(status_code=400, detail="Item is not flagged")

    # Clear the issue flag
    item.has_issue = False
    item.issue_description = None
    db.commit()

    return {"message": "Issue resolved successfully", "item_id": item_id}


# ============== UNRECEIVED ITEMS FROM PREVIOUS ORDERS ==============

@router.get("/unreceived-items", response_model=UnreceivedItemsList)
def get_all_unreceived_items(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get all items from previous orders that were not received or had quantity shortages.
    For purchasing team to see all unreceived items across all properties.
    """
    # Query order items with eager loading - no property filter
    query = db.query(OrderItem).options(
        joinedload(OrderItem.order).joinedload(Order.camp_property),
        joinedload(OrderItem.inventory_item),
        joinedload(OrderItem.supplier)
    ).join(Order).filter(
        Order.status.in_([OrderStatus.RECEIVED.value, OrderStatus.PARTIALLY_RECEIVED.value]),
        (OrderItem.shortage_dismissed == False) | (OrderItem.shortage_dismissed.is_(None))  # Exclude dismissed shortages
    )

    items = query.order_by(Order.week_of.desc()).all()

    # Pre-load all suppliers that might be needed (fix N+1 query)
    supplier_ids_needed = set()
    for item in items:
        if not item.supplier and item.inventory_item and item.inventory_item.supplier_id:
            supplier_ids_needed.add(item.inventory_item.supplier_id)

    suppliers_map = {}
    if supplier_ids_needed:
        suppliers = db.query(Supplier).filter(Supplier.id.in_(supplier_ids_needed)).all()
        suppliers_map = {s.id: s for s in suppliers}

    result = []
    total_shortage_value = 0.0

    for item in items:
        order = item.order
        approved_qty = item.approved_quantity or item.requested_quantity
        received_qty = item.received_quantity or 0
        shortage = approved_qty - received_qty

        if shortage > 0:
            if item.inventory_item:
                item_name = item.inventory_item.name
            else:
                item_name = item.custom_item_name or "Unknown Item"

            supplier_name = None
            supplier_id = None
            if item.supplier:
                supplier_name = item.supplier.name
                supplier_id = item.supplier.id
            elif item.inventory_item and item.inventory_item.supplier_id:
                supplier = suppliers_map.get(item.inventory_item.supplier_id)
                if supplier:
                    supplier_name = supplier.name
                    supplier_id = supplier.id

            unit_price = item.unit_price or 0
            shortage_value = shortage * unit_price
            total_shortage_value += shortage_value

            # Get property info from order
            prop = order.camp_property
            prop_id = prop.id if prop else order.property_id
            prop_name = prop.name if prop else None

            result.append(UnreceivedItemResponse(
                item_id=item.id,
                inventory_item_id=item.inventory_item_id,
                item_name=item_name,
                order_id=order.id,
                order_number=order.order_number,
                property_id=prop_id,
                property_name=prop_name,
                week_of=order.week_of,
                approved_quantity=approved_qty,
                received_quantity=received_qty,
                shortage=shortage,
                unit=item.unit,
                unit_price=unit_price,
                supplier_id=supplier_id,
                supplier_name=supplier_name,
                has_issue=item.has_issue,
                issue_description=item.issue_description
            ))

    return UnreceivedItemsList(
        items=result,
        total_count=len(result),
        total_shortage_value=total_shortage_value
    )


@router.get("/unreceived-items/{property_id}", response_model=UnreceivedItemsList)
def get_unreceived_items(
    property_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get items from previous orders that were not received or had quantity shortages.
    Used when creating new orders to carry forward unreceived items.

    Returns AGGREGATED items by inventory_item_id where:
    - Order is in 'received' or 'partially_received' status
    - Item was not received OR received less than approved quantity
    - Shortage has not been dismissed by user
    """
    require_property_access(property_id, current_user)

    # Query order items with eager loading, excluding dismissed shortages
    query = db.query(OrderItem).options(
        joinedload(OrderItem.order),
        joinedload(OrderItem.inventory_item),
        joinedload(OrderItem.supplier)
    ).join(Order).filter(
        Order.property_id == property_id,
        Order.status.in_([OrderStatus.RECEIVED.value, OrderStatus.PARTIALLY_RECEIVED.value]),
        (OrderItem.shortage_dismissed == False) | (OrderItem.shortage_dismissed.is_(None))  # Exclude dismissed shortages
    )

    items = query.order_by(Order.week_of.desc()).all()

    # Get property name once
    prop = db.query(Property).filter(Property.id == property_id).first()
    prop_name = prop.name if prop else None

    # Get only the MOST RECENT shortage for each item (not aggregated)
    # Items are sorted by week_of desc, so first occurrence is most recent
    most_recent: dict = {}  # key: inventory_item_id or f"custom:{name}"
    total_shortage_value = 0.0

    for item in items:
        order = item.order
        approved_qty = item.approved_quantity or item.requested_quantity
        received_qty = item.received_quantity or 0
        shortage = approved_qty - received_qty

        if shortage <= 0:
            continue

        # Determine key for grouping
        if item.inventory_item_id:
            key = item.inventory_item_id
            item_name = item.inventory_item.name if item.inventory_item else "Unknown Item"
        else:
            # For custom items, use the name as key
            item_name = item.custom_item_name or "Unknown Item"
            key = f"custom:{item_name.lower()}"

        # Only keep the MOST RECENT order's shortage (first one we see since sorted desc)
        if key in most_recent:
            continue

        # Get supplier info
        supplier_name = None
        supplier_id = None
        if item.supplier:
            supplier_name = item.supplier.name
            supplier_id = item.supplier.id
        elif item.inventory_item and item.inventory_item.supplier_id:
            supplier = db.query(Supplier).filter(Supplier.id == item.inventory_item.supplier_id).first()
            if supplier:
                supplier_name = supplier.name
                supplier_id = supplier.id

        unit_price = item.unit_price or 0
        shortage_value = shortage * unit_price
        total_shortage_value += shortage_value

        most_recent[key] = {
            'inventory_item_id': item.inventory_item_id,
            'item_name': item_name,
            'total_shortage': shortage,  # Just this order's shortage, not aggregated
            'unit': item.unit,
            'unit_price': unit_price,
            'supplier_id': supplier_id,
            'supplier_name': supplier_name,
            'source_order_item_ids': [item.id],  # Only this order item
            'latest_order_number': order.order_number,
            'latest_week_of': order.week_of,
            'order_count': 1  # Always 1 since we're not aggregating
        }

    # Build result list
    result = [
        UnreceivedItemResponse(
            inventory_item_id=data['inventory_item_id'],
            item_name=data['item_name'],
            total_shortage=data['total_shortage'],
            unit=data['unit'],
            unit_price=data['unit_price'],
            supplier_id=data['supplier_id'],
            supplier_name=data['supplier_name'],
            property_id=property_id,
            property_name=prop_name,
            source_order_item_ids=data['source_order_item_ids'],
            latest_order_number=data['latest_order_number'],
            latest_week_of=data['latest_week_of'],
            order_count=data['order_count']
        )
        for data in most_recent.values()
    ]

    # Sort by shortage descending
    result.sort(key=lambda x: x.total_shortage, reverse=True)

    return UnreceivedItemsList(
        items=result,
        total_count=len(result),
        total_shortage_value=total_shortage_value
    )


@router.post("/dismiss-shortage", status_code=status.HTTP_200_OK)
def dismiss_shortage(
    request: DismissShortageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Dismiss shortages so they no longer appear in the unreceived items list.
    Used when a shortage has been resolved through other means (found in stock,
    no longer needed, etc.)
    """
    if not request.order_item_ids:
        raise HTTPException(status_code=400, detail="No order item IDs provided")

    # Get all order items and verify access
    items = db.query(OrderItem).options(
        joinedload(OrderItem.order)
    ).filter(OrderItem.id.in_(request.order_item_ids)).all()

    if not items:
        raise HTTPException(status_code=404, detail="No order items found")

    # Verify user has access to the property for each item
    for item in items:
        require_property_access(item.order.property_id, current_user)

    # Mark all items as dismissed
    dismissed_count = 0
    for item in items:
        if not item.shortage_dismissed:
            item.shortage_dismissed = True
            dismissed_count += 1

    db.commit()

    return {"message": f"Dismissed {dismissed_count} shortage(s)", "dismissed_count": dismissed_count}


@router.get("/{order_id}", response_model=OrderWithItems)
def get_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get order details with items"""
    # Use eager loading to prevent N+1 queries
    order = _get_order_query_with_eager_loading(db).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    return _build_order_with_items(order, db)


def _build_order_with_items(order: Order, db: Session) -> OrderWithItems:
    """Helper to build order response with items.
    Note: Expects order to be loaded with eager loading via _get_order_query_with_eager_loading()
    """
    # Validate base order fields only (without items) to avoid model_validate
    # picking up @property methods or failing on relationship traversal
    base_data = OrderResponse.model_validate(order).model_dump()

    # Use eagerly loaded camp_property (falls back to query if not loaded)
    if order.camp_property:
        base_data["property_name"] = order.camp_property.name
    else:
        prop = db.query(Property).filter(Property.id == order.property_id).first()
        base_data["property_name"] = prop.name if prop else None

    # Get user names from eagerly loaded relationships
    base_data["created_by_name"] = None
    if order.created_by_user:
        base_data["created_by_name"] = order.created_by_user.full_name or order.created_by_user.email
    base_data["reviewed_by_name"] = None
    if order.reviewed_by_user:
        base_data["reviewed_by_name"] = order.reviewed_by_user.full_name or order.reviewed_by_user.email

    # Build items with details and calculate totals
    items = []
    total_requested = 0.0
    total_approved = 0.0

    for item in order.items:
        # Build base item data without computed fields
        item_data = OrderItemResponse.model_validate(item).model_dump()

        # Get item name, category, and inventory data
        if item.inventory_item:
            item_data["item_name"] = item.inventory_item.name
            item_data["category"] = item.inventory_item.category
            item_data["qty"] = item.inventory_item.qty
            item_data["par_level"] = item.inventory_item.par_level
            item_data["order_at"] = item.inventory_item.order_at
            item_data["current_stock"] = item.inventory_item.current_stock
        else:
            item_data["item_name"] = item.custom_item_name or "Custom Item"
            item_data["category"] = None
            item_data["qty"] = None
            item_data["par_level"] = None
            item_data["order_at"] = None
            item_data["current_stock"] = None

        # Get supplier name and ID - try from order item first, then from inventory item
        if item.supplier_id and item.supplier:
            item_data["supplier_id"] = item.supplier_id
            item_data["supplier_name"] = item.supplier.name
        elif item.inventory_item and item.inventory_item.supplier_id and item.inventory_item.supplier:
            item_data["supplier_id"] = item.inventory_item.supplier_id
            item_data["supplier_name"] = item.inventory_item.supplier.name
        else:
            item_data["supplier_name"] = None

        # Calculate quantities
        final_qty = item.approved_quantity if item.approved_quantity is not None else item.requested_quantity
        item_data["final_quantity"] = final_qty
        item_data["line_total"] = final_qty * (item.unit_price or 0)

        # Calculate totals for requested and approved values
        unit_price = item.unit_price or 0
        total_requested += item.requested_quantity * unit_price
        if item.approved_quantity is not None:
            total_approved += item.approved_quantity * unit_price
        else:
            total_approved += item.requested_quantity * unit_price

        items.append(OrderItemWithDetails(**item_data))

    base_data["items"] = items
    base_data["total_requested_value"] = total_requested
    base_data["total_approved_value"] = total_approved

    return OrderWithItems(**base_data)


@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    order_data: OrderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create new order (draft)"""
    require_property_access(order_data.property_id, current_user)

    # Get property to use its code for order number
    property = db.query(Property).filter(Property.id == order_data.property_id).first()
    if not property:
        raise HTTPException(status_code=404, detail="Property not found")

    order = Order(
        order_number=generate_order_number(property.code),
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
        inventory_item_id = item_data.inventory_item_id

        # For custom items, create a non-recurring inventory item so it's searchable next time
        if inventory_item_id is None and item_data.custom_item_name:
            # Check if a similar non-recurring item already exists for this property
            existing_item = db.query(InventoryItem).filter(
                InventoryItem.property_id == order_data.property_id,
                InventoryItem.name.ilike(item_data.custom_item_name.strip()),
                InventoryItem.is_recurring == False
            ).first()

            if existing_item:
                # Use the existing item
                inventory_item_id = existing_item.id
            else:
                # Create a new non-recurring inventory item
                new_inv_item = InventoryItem(
                    property_id=order_data.property_id,
                    name=item_data.custom_item_name.strip(),
                    unit=item_data.unit or "Each",
                    is_recurring=False,  # Non-recurring/one-off item
                    is_active=True,
                    current_stock=0
                )
                db.add(new_inv_item)
                db.flush()  # Get the ID
                inventory_item_id = new_inv_item.id
                logger.info(f"Created non-recurring inventory item '{new_inv_item.name}' (ID: {new_inv_item.id}) for property {order_data.property_id}")

        order_item = OrderItem(
            order_id=order.id,
            inventory_item_id=inventory_item_id,
            custom_item_name=item_data.custom_item_name if inventory_item_id is None else None,
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


@router.post("/{order_id}/add-review-item", response_model=OrderResponse)
def add_review_item(
    order_id: int,
    item_data: OrderItemCreate,
    current_user: User = Depends(require_supervisor_or_admin),
    db: Session = Depends(get_db)
):
    """
    Add an item to an order during review.
    Used by purchasing supervisors to add items from the property's inventory
    while reviewing a submitted order.
    Only works for orders in 'submitted' or 'under_review' status.
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status not in [OrderStatus.SUBMITTED.value, OrderStatus.UNDER_REVIEW.value]:
        raise HTTPException(
            status_code=400,
            detail="Can only add items to orders under review (submitted or under_review status)"
        )

    # Get unit and price from inventory item if provided
    unit = item_data.unit
    unit_price = item_data.unit_price
    supplier_id = item_data.supplier_id
    inventory_item_id = item_data.inventory_item_id

    if inventory_item_id:
        inv_item = db.query(InventoryItem).filter(InventoryItem.id == inventory_item_id).first()
        if inv_item:
            if not unit:
                unit = inv_item.unit
            if not unit_price:
                unit_price = inv_item.unit_price
            if not supplier_id:
                supplier_id = inv_item.supplier_id

    # Create the order item
    order_item = OrderItem(
        order_id=order.id,
        inventory_item_id=inventory_item_id,
        custom_item_name=item_data.custom_item_name if inventory_item_id is None else None,
        custom_item_description=item_data.custom_item_description,
        supplier_id=supplier_id,
        flag=OrderItemFlag.MANUAL.value,
        requested_quantity=item_data.requested_quantity,
        approved_quantity=item_data.requested_quantity,  # Auto-set approved = requested
        unit=unit,
        unit_price=unit_price,
        camp_notes=item_data.camp_notes
    )
    db.add(order_item)
    db.commit()

    # Recalculate order total
    order.estimated_total = calculate_order_total(order)
    db.commit()
    db.refresh(order)

    logger.info(f"Added item to order {order.order_number} during review by {current_user.email}")
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

    # Update the item
    if item_data.approved_quantity is not None:
        item.approved_quantity = item_data.approved_quantity
    if item_data.reviewer_notes is not None:
        item.reviewer_notes = item_data.reviewer_notes
    # Allow supervisor to update supplier for any item
    if item_data.supplier_id is not None:
        item.supplier_id = item_data.supplier_id

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
        item_detail.qty = item.inventory_item.qty
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


@router.delete("/{order_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order_item(
    order_id: int,
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete item from draft or changes_requested order"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    # Allow deletion from draft or changes_requested orders
    if order.status not in [OrderStatus.DRAFT.value, OrderStatus.CHANGES_REQUESTED.value]:
        raise HTTPException(status_code=400, detail="Can only edit draft or changes_requested orders")

    # Only creator or admin can delete items
    if order.created_by != current_user.id and current_user.role != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Can only edit your own orders")

    item = db.query(OrderItem).filter(
        OrderItem.id == item_id,
        OrderItem.order_id == order_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")

    db.delete(item)

    # Recalculate order total
    order.estimated_total = calculate_order_total(order)

    db.commit()


@router.patch("/{order_id}/items/{item_id}", response_model=OrderResponse)
def update_draft_order_item(
    order_id: int,
    item_id: int,
    quantity: int = Query(..., ge=1),
    unit: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update item quantity and/or unit in draft or changes_requested order (for camp worker)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    # Allow updates to draft or changes_requested orders
    if order.status not in [OrderStatus.DRAFT.value, OrderStatus.CHANGES_REQUESTED.value]:
        raise HTTPException(status_code=400, detail="Can only edit draft or changes_requested orders")

    # Only creator or admin can update items
    if order.created_by != current_user.id and current_user.role != UserRole.ADMIN.value:
        raise HTTPException(status_code=403, detail="Can only edit your own orders")

    item = db.query(OrderItem).filter(
        OrderItem.id == item_id,
        OrderItem.order_id == order_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")

    item.requested_quantity = quantity
    if unit is not None:
        item.unit = unit

    # Recalculate order total
    order.estimated_total = calculate_order_total(order)

    db.commit()
    db.refresh(order)
    return order


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
                week_of=week_of_str
            )
    except Exception as e:
        logger.error(f"Failed to send order submission notification: {str(e)}")

    return order


@router.post("/{order_id}/withdraw", response_model=OrderResponse)
def withdraw_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Withdraw order from review back to draft status (camp worker or supervisor)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    # Allow withdrawal from submitted, under_review, or approved status
    allowed_statuses = [OrderStatus.SUBMITTED.value, OrderStatus.UNDER_REVIEW.value, OrderStatus.APPROVED.value]
    if order.status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot withdraw order with status '{order.status}'. Order must be pending review or approved."
        )

    order.status = OrderStatus.DRAFT.value
    order.submitted_at = None

    db.commit()
    db.refresh(order)
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


@router.post("/{order_id}/unmark-ordered", response_model=OrderResponse)
def unmark_order_ordered(
    order_id: int,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Revert order from ordered back to approved (purchasing team)"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status != OrderStatus.ORDERED.value:
        raise HTTPException(status_code=400, detail="Order is not in ordered status")

    order.status = OrderStatus.APPROVED.value
    order.ordered_at = None

    db.commit()
    db.refresh(order)
    return order


@router.post("/{order_id}/add-receiving-item", response_model=OrderResponse)
def add_receiving_item(
    order_id: int,
    item_data: OrderItemCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Add an item to an order during receiving.
    Used for late shipments that arrive after the original order was placed.
    Only works for orders in 'ordered' or 'partially_received' status.
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    if order.status not in [OrderStatus.ORDERED.value, OrderStatus.PARTIALLY_RECEIVED.value]:
        raise HTTPException(
            status_code=400,
            detail="Can only add items to orders that are being received (ordered or partially_received status)"
        )

    # Get unit and price from inventory item if not provided
    unit = item_data.unit
    unit_price = item_data.unit_price
    supplier_id = item_data.supplier_id
    inventory_item_id = item_data.inventory_item_id

    if inventory_item_id:
        inv_item = db.query(InventoryItem).filter(InventoryItem.id == inventory_item_id).first()
        if inv_item:
            if not unit:
                unit = inv_item.unit
            if not unit_price:
                unit_price = inv_item.unit_price
            if not supplier_id:
                supplier_id = inv_item.supplier_id
    elif item_data.custom_item_name:
        # For custom items, create a non-recurring inventory item so it's searchable next time
        existing_item = db.query(InventoryItem).filter(
            InventoryItem.property_id == order.property_id,
            InventoryItem.name.ilike(item_data.custom_item_name.strip()),
            InventoryItem.is_recurring == False
        ).first()

        if existing_item:
            inventory_item_id = existing_item.id
        else:
            new_inv_item = InventoryItem(
                property_id=order.property_id,
                name=item_data.custom_item_name.strip(),
                unit=unit or "Each",
                is_recurring=False,
                is_active=True,
                current_stock=0
            )
            db.add(new_inv_item)
            db.flush()
            inventory_item_id = new_inv_item.id
            logger.info(f"Created non-recurring inventory item '{new_inv_item.name}' (ID: {new_inv_item.id}) during receiving")

    # Create the order item - use flag 'manual' since this is a late addition
    order_item = OrderItem(
        order_id=order.id,
        inventory_item_id=inventory_item_id,
        custom_item_name=item_data.custom_item_name if inventory_item_id is None else None,
        custom_item_description=item_data.custom_item_description,
        supplier_id=supplier_id,
        flag=OrderItemFlag.MANUAL.value,
        requested_quantity=item_data.requested_quantity,
        approved_quantity=item_data.requested_quantity,  # Auto-approve since order is already approved
        unit=unit,
        unit_price=unit_price,
        camp_notes=item_data.camp_notes
    )
    db.add(order_item)
    db.commit()

    # Recalculate order total
    order.estimated_total = calculate_order_total(order)
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
    """
    Mark items as received with proper error handling and transaction safety.

    When finalize=False (default): Saves receiving progress without updating inventory.
    When finalize=True: Marks items as received, updates inventory, and sends notifications.
    """
    # Use eager loading for order and items
    order = db.query(Order).options(
        joinedload(Order.items).joinedload(OrderItem.inventory_item),
        joinedload(Order.camp_property)
    ).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    require_property_access(order.property_id, current_user)

    # Allow receiving for ordered, partially_received, and received orders (for edits)
    if order.status not in [OrderStatus.ORDERED.value, OrderStatus.PARTIALLY_RECEIVED.value, OrderStatus.RECEIVED.value]:
        raise HTTPException(status_code=400, detail="Order not ready for receiving")

    # Validate all item IDs exist before processing (fail-fast)
    order_item_ids = {item.id for item in order.items}
    invalid_item_ids = [item_req.item_id for item_req in request.items if item_req.item_id not in order_item_ids]
    if invalid_item_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Order items not found: {invalid_item_ids}. These items do not belong to this order."
        )

    # Create a map for quick item lookup
    item_map = {item.id: item for item in order.items}

    # Track flagged items for notification (only when finalizing)
    flagged_items = []

    # Process all items (we've validated they all exist)
    for item_req in request.items:
        item = item_map[item_req.item_id]
        old_received_quantity = item.received_quantity or 0
        was_already_received = item.is_received

        item.received_quantity = item_req.received_quantity
        item.has_issue = item_req.has_issue
        item.issue_description = item_req.issue_description
        item.issue_photo_url = item_req.issue_photo_url
        item.receiving_notes = item_req.receiving_notes

        # Only mark as received and update inventory when finalizing
        if request.finalize:
            item.is_received = True

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
                if was_already_received:
                    # Item was already received - adjust inventory by the difference
                    quantity_difference = item_req.received_quantity - old_received_quantity
                    item.inventory_item.current_stock = (item.inventory_item.current_stock or 0) + quantity_difference
                else:
                    # New receiving - add full quantity
                    item.inventory_item.current_stock = (item.inventory_item.current_stock or 0) + item_req.received_quantity

    # Only update order status when finalizing
    if request.finalize:
        # Check if all items received
        all_received = all(i.is_received for i in order.items)
        if all_received:
            order.status = OrderStatus.RECEIVED.value
            order.received_at = datetime.utcnow()
        else:
            order.status = OrderStatus.PARTIALLY_RECEIVED.value

    db.commit()
    db.refresh(order)

    # Send notifications if items were flagged (only when finalizing)
    if request.finalize and flagged_items:
        # Use eagerly loaded property name
        property_name = order.camp_property.name if order.camp_property else "Unknown Property"

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


# ============== ISSUE PHOTO UPLOAD ==============

@router.post("/upload-issue-photo")
async def upload_issue_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Upload a photo for a receiving issue.
    Returns the URL path to the uploaded file.
    """
    # Validate file type
    filename_lower = file.filename.lower() if file.filename else ""
    is_heic = any(filename_lower.endswith(ext) for ext in ['.heic', '.heif'])
    is_standard = any(filename_lower.endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp'])

    if not is_heic and not is_standard:
        raise HTTPException(
            status_code=400,
            detail="Only JPG, PNG, WebP, and HEIC images are supported"
        )

    # Read file content
    content = await file.read()

    # Convert HEIC to JPEG if needed
    if is_heic:
        try:
            import pillow_heif
            from PIL import Image
            import io

            pillow_heif.register_heif_opener()
            heif_image = Image.open(io.BytesIO(content))

            if heif_image.mode in ('RGBA', 'P'):
                heif_image = heif_image.convert('RGB')

            jpeg_buffer = io.BytesIO()
            heif_image.save(jpeg_buffer, format='JPEG', quality=85)
            content = jpeg_buffer.getvalue()
            filename_lower = filename_lower.replace('.heic', '.jpg').replace('.heif', '.jpg')
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="HEIC support not available"
            )
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to convert HEIC image: {str(e)}"
            )

    # File size limit (5MB)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="File size exceeds 5MB limit"
        )

    # Save image to uploads directory
    uploads_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads", "issues")
    os.makedirs(uploads_dir, exist_ok=True)

    file_ext = ".jpg" if is_heic else (os.path.splitext(file.filename)[1] if file.filename else ".jpg")
    filename = f"{uuid.uuid4().hex}{file_ext}"
    file_path = os.path.join(uploads_dir, filename)

    with open(file_path, "wb") as f:
        f.write(content)

    return {"url": f"/uploads/issues/{filename}"}


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
