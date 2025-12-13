from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
import base64
import json
import logging
import os
import uuid
import io

from app.core.database import get_db
from app.core.config import settings
from app.core.security import get_current_user, require_purchasing_team
from app.models.user import User
from app.models.receipt import Receipt
from app.models.order import Order, OrderItem
from app.models.property import Property
from app.models.supplier import Supplier
from app.models.inventory import InventoryItem
from app.schemas.receipt import (
    ReceiptCreate, ReceiptUpdate, ReceiptResponse, ReceiptWithDetails,
    ReceiptLineItem, FinancialDashboard, SupplierSpendingSummary,
    PropertySpendingSummary, SpendingByPeriod, ReceiptExtractionResult,
    UnmatchedReceiptItem, AddUnmatchedToInventory
)
from app.schemas.inventory import InventoryItemResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/receipts", tags=["Receipts"])


# ============== HELPER FUNCTIONS ==============

async def extract_receipt_with_ai(image_content: bytes, order_items: List[dict], property_name: str = None, property_code: str = None) -> ReceiptExtractionResult:
    """Use OpenAI Vision to extract receipt data and match to order items"""
    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured. Please set OPENAI_API_KEY in environment."
        )

    try:
        import openai
        client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)

        # Build order items list for matching
        order_items_str = "\n".join([
            f"- ID {item['id']}: {item['name']} (qty: {item['quantity']}, unit: {item['unit']})"
            for item in order_items
        ])

        # Build property context for multi-camp receipts
        # List all known property codes so AI knows what to look for
        all_property_codes = ["YRC", "SCC", "DHC", "CXF", "MLY", "HMG"]
        other_codes = [c for c in all_property_codes if c != property_code] if property_code else all_property_codes

        property_context = ""
        if property_code or property_name:
            property_context = f"""
LOCATION/CAMP FILTERING - READ CAREFULLY:
This receipt is being uploaded for: {property_name} (code: {property_code})

The image may show items marked/highlighted for different camps. Here's how to handle it:
- Items marked "{property_code}" or "{property_name}" → INCLUDE these
- Items with NO location marking → INCLUDE these (assume they're for {property_code})
- Items marked with OTHER codes like {', '.join(other_codes[:3])} → SKIP/EXCLUDE these

Look for handwritten notes, highlighting, or annotations that indicate which camp an item belongs to.
"""

        system_prompt = f"""You are an expert at extracting data from purchase receipts.

STEP 1 - FIND THE STORE NAME (CRITICAL):
Look at the VERY TOP of the receipt for the store/supplier name. This is usually:
- Large bold text or a logo
- Names like: COSTCO, COSTCO WHOLESALE, Walmart, Sam's Club, Safeway, Fred Meyer, Charlie's Produce, Sysco, US Foods, Restaurant Depot, GFS
- The store name is NOT an item being purchased

If you see "COSTCO" or "COSTCO WHOLESALE" anywhere in the header → supplier_name = "Costco"
If you see "WALMART" → supplier_name = "Walmart"
DO NOT confuse item names with the store name.

{property_context}

STEP 2 - EXTRACT ALL LINE ITEMS:
For each item on the receipt, extract:
- item_name: exactly as printed
- quantity: number of units
- unit_price: price per unit
- total_price: line total

STEP 3 - MATCH TO ORDER ITEMS (CRITICAL - READ CAREFULLY):
These are the items from the order you should try to match against:
{order_items_str}

YOU MUST TRY VERY HARD TO MATCH EACH RECEIPT ITEM TO AN ORDER ITEM ABOVE.

MATCHING RULES - BE EXTREMELY AGGRESSIVE:
1. Truncated/abbreviated names ALWAYS match full names:
   - "PORK TENDER" → match to "Pork Tenderloins" ✓
   - "BNLS CHKN" → match to "Boneless Chicken" ✓
   - "GRN ONIONS" → match to "Green Onions" ✓
   - "ORG MILK" → match to "Organic Milk" ✓

2. Partial matches are VALID - if the first word matches, it's probably a match:
   - "PORK" in receipt + "Pork Tenderloins" in order → MATCH
   - "CHICKEN" in receipt + "Chicken Breast" in order → MATCH
   - "EGGS" in receipt + "Large Eggs" in order → MATCH

3. Quantity descriptors don't prevent matching:
   - "5DZ EGGS" → match to "Eggs" or "Large Eggs" ✓
   - "24PK WATER" → match to "Bottled Water" ✓

4. DEFAULT TO MATCHING: If there's ANY reasonable similarity, assign a matched_order_item_id.
   Only leave unmatched if absolutely no plausible match exists.

5. ITERATE THROUGH EACH ORDER ITEM and ask: "Could this receipt item be this order item?"
   If the answer is "maybe" or "probably", then MATCH IT.

STEP 4 - RETURN JSON:
{{
    "supplier_name": "Store name from receipt header - MUST be filled in",
    "receipt_date": "YYYY-MM-DD or null",
    "subtotal": number or null,
    "tax": number or null,
    "total": number or null,
    "line_items": [
        {{
            "item_name": "as on receipt",
            "quantity": number,
            "unit_price": number or null,
            "total_price": number or null,
            "matched_order_item_id": order_item_id or null
        }}
    ],
    "unmatched_items": [
        {{
            "item_name": "as on receipt",
            "suggested_name": "clean readable name",
            "quantity": number,
            "unit_price": number or null,
            "total_price": number or null,
            "suggested_category": "Protein/Dairy/Produce/etc"
        }}
    ],
    "confidence_score": 0.0 to 1.0
}}

IMPORTANT REMINDERS:
1. supplier_name MUST be the store from the receipt header (Costco, Walmart, etc) - NOT an item name
2. Extract items from ALL receipts visible in the image
3. Include items marked for {property_code or 'our location'} or unmarked items
4. EXCLUDE items clearly marked for other locations"""

        # Encode image as base64
        image_base64 = base64.standard_b64encode(image_content).decode("utf-8")

        # Detect image type from content
        if image_content[:8] == b'\x89PNG\r\n\x1a\n':
            media_type = "image/png"
        elif image_content[:2] == b'\xff\xd8':
            media_type = "image/jpeg"
        else:
            media_type = "image/jpeg"  # Default to JPEG

        response = client.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Please extract all items from this receipt and match them to the order items. Return the data as JSON."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{media_type};base64,{image_base64}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=4096,
            response_format={"type": "json_object"}
        )

        # Parse the response
        result_text = response.choices[0].message.content
        result_data = json.loads(result_text)

        # Parse date if present
        receipt_date = None
        if result_data.get("receipt_date"):
            try:
                receipt_date = datetime.fromisoformat(result_data["receipt_date"])
            except ValueError:
                pass

        # Convert to schema
        line_items = []
        for item in result_data.get("line_items", []):
            line_items.append(ReceiptLineItem(
                item_name=item.get("item_name", "Unknown Item"),
                quantity=float(item["quantity"]) if item.get("quantity") else None,
                unit_price=float(item["unit_price"]) if item.get("unit_price") else None,
                total_price=float(item["total_price"]) if item.get("total_price") else None,
                matched_order_item_id=item.get("matched_order_item_id")
            ))

        # Parse unmatched items
        unmatched_items = []
        for item in result_data.get("unmatched_items", []):
            unmatched_items.append(UnmatchedReceiptItem(
                item_name=item.get("item_name", "Unknown Item"),
                suggested_name=item.get("suggested_name"),
                quantity=float(item["quantity"]) if item.get("quantity") else None,
                unit_price=float(item["unit_price"]) if item.get("unit_price") else None,
                total_price=float(item["total_price"]) if item.get("total_price") else None,
                suggested_category=item.get("suggested_category")
            ))

        return ReceiptExtractionResult(
            supplier_name=result_data.get("supplier_name"),
            receipt_date=receipt_date,
            subtotal=float(result_data["subtotal"]) if result_data.get("subtotal") else None,
            tax=float(result_data["tax"]) if result_data.get("tax") else None,
            total=float(result_data["total"]) if result_data.get("total") else None,
            line_items=line_items,
            unmatched_items=unmatched_items,
            confidence_score=float(result_data.get("confidence_score", 0.8)),
            raw_text=result_text
        )

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse AI response as JSON: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to parse receipt data. The AI response was not valid JSON."
        )
    except Exception as e:
        logger.error(f"Error extracting receipt: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to extract receipt data: {str(e)}"
        )


def _update_inventory_prices_from_receipt(line_items: List[dict], db: Session) -> int:
    """
    Update inventory item unit prices based on receipt line items.
    Returns the number of items updated.
    """
    updated_count = 0

    for line_item in line_items:
        # Skip items without a matched order item or unit price
        matched_order_item_id = line_item.get("matched_order_item_id")
        unit_price = line_item.get("unit_price")

        if not matched_order_item_id or not unit_price:
            continue

        # Get the order item to find the inventory item
        order_item = db.query(OrderItem).filter(OrderItem.id == matched_order_item_id).first()
        if not order_item or not order_item.inventory_item_id:
            continue

        # Update the inventory item's unit price
        inventory_item = db.query(InventoryItem).filter(
            InventoryItem.id == order_item.inventory_item_id
        ).first()

        if inventory_item:
            inventory_item.unit_price = unit_price
            updated_count += 1
            logger.info(f"Updated price for inventory item '{inventory_item.name}' to ${unit_price}")

    if updated_count > 0:
        db.commit()
        logger.info(f"Updated unit prices for {updated_count} inventory items from receipt")

    return updated_count


# ============== UPLOAD ENDPOINT ==============

@router.post("/upload", response_model=ReceiptWithDetails)
async def upload_receipt(
    file: UploadFile = File(...),
    order_id: int = Form(...),
    notes: Optional[str] = Form(None),
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """
    Upload a receipt image, extract data with AI, and match to order items.
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

    # Validate order exists
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Read file content
    content = await file.read()

    # Convert HEIC to JPEG if needed
    if is_heic:
        try:
            import pillow_heif
            from PIL import Image

            # Register HEIF opener with PIL
            pillow_heif.register_heif_opener()

            # Open HEIC image
            heif_image = Image.open(io.BytesIO(content))

            # Convert to RGB if necessary (HEIC can have alpha channel)
            if heif_image.mode in ('RGBA', 'P'):
                heif_image = heif_image.convert('RGB')

            # Save as JPEG to bytes
            jpeg_buffer = io.BytesIO()
            heif_image.save(jpeg_buffer, format='JPEG', quality=95)
            content = jpeg_buffer.getvalue()

            # Update filename extension for saving
            filename_lower = filename_lower.replace('.heic', '.jpg').replace('.heif', '.jpg')

        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="HEIC support not available. Please install pillow-heif: pip install pillow-heif"
            )
        except Exception as e:
            logger.error(f"Error converting HEIC image: {e}")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to convert HEIC image: {str(e)}"
            )

    if len(content) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(
            status_code=400,
            detail="File size exceeds 10MB limit"
        )

    # Build order items list for AI matching
    order_items = []
    for item in order.items:
        item_name = item.custom_item_name
        if item.inventory_item:
            item_name = item.inventory_item.name
        order_items.append({
            "id": item.id,
            "name": item_name,
            "quantity": item.approved_quantity or item.requested_quantity,
            "unit": item.unit or "Unit"
        })

    # Get property info for multi-camp receipt handling
    property_name = None
    property_code = None
    if order.camp_property:
        property_name = order.camp_property.name
        property_code = order.camp_property.code

    # Extract receipt data using AI
    extracted_data = await extract_receipt_with_ai(content, order_items, property_name, property_code)

    # Save image to uploads directory
    uploads_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads", "receipts")
    os.makedirs(uploads_dir, exist_ok=True)

    # Use .jpg extension if HEIC was converted, otherwise use original extension
    file_ext = ".jpg" if is_heic else (os.path.splitext(file.filename)[1] if file.filename else ".jpg")
    filename = f"{uuid.uuid4().hex}{file_ext}"
    file_path = os.path.join(uploads_dir, filename)

    with open(file_path, "wb") as f:
        f.write(content)

    # Match supplier from AI-detected name
    supplier_id = None
    detected_supplier_name = extracted_data.supplier_name

    if detected_supplier_name:
        # Try to match detected supplier name to existing suppliers
        # Use case-insensitive partial match
        suppliers = db.query(Supplier).filter(Supplier.is_active == True).all()
        detected_lower = detected_supplier_name.lower().strip()

        # First try exact match
        for supplier in suppliers:
            if supplier.name.lower().strip() == detected_lower:
                supplier_id = supplier.id
                logger.info(f"Exact match: receipt supplier '{detected_supplier_name}' to '{supplier.name}'")
                break

        # Then try partial match if no exact match
        if not supplier_id:
            for supplier in suppliers:
                supplier_name_lower = supplier.name.lower()
                # Check if supplier name contains detected name or vice versa
                if detected_lower in supplier_name_lower or supplier_name_lower in detected_lower:
                    supplier_id = supplier.id
                    logger.info(f"Partial match: receipt supplier '{detected_supplier_name}' to '{supplier.name}'")
                    break

        # If AI detected a supplier but we can't match it, create it or log warning
        if not supplier_id:
            logger.warning(f"Could not match detected supplier '{detected_supplier_name}' to any existing supplier - consider adding it")

    # Only fallback to order's supplier if AI returned null/empty supplier name
    # This prevents overwriting a valid AI detection with wrong data
    if not supplier_id and not detected_supplier_name and order.items and order.items[0].supplier_id:
        supplier_id = order.items[0].supplier_id
        logger.info(f"Using fallback supplier from order item (AI didn't detect a supplier)")

    # Create receipt record
    receipt = Receipt(
        order_id=order_id,
        supplier_id=supplier_id,
        image_url=f"/uploads/receipts/{filename}",
        receipt_date=extracted_data.receipt_date,
        subtotal=extracted_data.subtotal,
        tax=extracted_data.tax,
        total=extracted_data.total,
        line_items=[item.model_dump() for item in extracted_data.line_items],
        is_processed=True,
        confidence_score=extracted_data.confidence_score,
        uploaded_by=current_user.id,
        notes=notes
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)

    # Update order actual total
    _update_order_actual_total(order_id, db)

    # Update inventory item unit prices from receipt line items
    _update_inventory_prices_from_receipt(receipt.line_items, db)

    # Build response
    receipt_data = ReceiptWithDetails.model_validate(receipt)
    receipt_data.order_number = order.order_number
    if receipt.supplier:
        receipt_data.supplier_name = receipt.supplier.name
    receipt_data.uploaded_by_name = current_user.full_name or current_user.email
    receipt_data.parsed_line_items = extracted_data.line_items
    receipt_data.unmatched_items = [item.model_dump() for item in extracted_data.unmatched_items]
    receipt_data.detected_supplier_name = detected_supplier_name

    return receipt_data


@router.get("/properties", response_model=List[dict])
def list_properties_for_receipts(
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """List all properties for receipt upload dropdown"""
    properties = db.query(Property).filter(Property.is_active == True).all()
    return [{"id": p.id, "name": p.name, "code": p.code} for p in properties]


@router.get("/orders-by-property/{property_id}", response_model=List[dict])
def list_orders_for_property(
    property_id: int,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """List orders for a property (for receipt upload - shows ordered/received orders)"""
    orders = db.query(Order).filter(
        Order.property_id == property_id,
        Order.status.in_(["ordered", "partially_received", "received"])
    ).order_by(Order.created_at.desc()).limit(50).all()

    return [{
        "id": o.id,
        "order_number": o.order_number,
        "status": o.status,
        "week_of": o.week_of.isoformat() if o.week_of else None,
        "item_count": len(o.items),
        "estimated_total": o.estimated_total,
        "created_at": o.created_at.isoformat() if o.created_at else None
    } for o in orders]


# ============== LIST ENDPOINTS ==============

@router.get("", response_model=List[ReceiptWithDetails])
def list_receipts(
    order_id: Optional[int] = None,
    supplier_id: Optional[int] = None,
    is_processed: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List receipts"""
    query = db.query(Receipt)

    if order_id:
        query = query.filter(Receipt.order_id == order_id)
    if supplier_id:
        query = query.filter(Receipt.supplier_id == supplier_id)
    if is_processed is not None:
        query = query.filter(Receipt.is_processed == is_processed)

    receipts = query.order_by(Receipt.created_at.desc()).offset(skip).limit(limit).all()

    result = []
    for receipt in receipts:
        receipt_data = ReceiptWithDetails.model_validate(receipt)
        if receipt.order:
            receipt_data.order_number = receipt.order.order_number
        if receipt.supplier:
            receipt_data.supplier_name = receipt.supplier.name
        if receipt.uploaded_by_user:
            receipt_data.uploaded_by_name = receipt.uploaded_by_user.full_name or receipt.uploaded_by_user.email

        # Parse line items
        if receipt.line_items:
            receipt_data.parsed_line_items = [
                ReceiptLineItem(**item) if isinstance(item, dict) else item
                for item in receipt.line_items
            ]

        result.append(receipt_data)

    return result


@router.get("/pending-verification", response_model=List[ReceiptWithDetails])
def list_pending_verification(
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """List receipts pending manual verification"""
    receipts = db.query(Receipt).filter(
        Receipt.is_processed == True,
        Receipt.is_manually_verified == False
    ).order_by(Receipt.created_at).all()

    result = []
    for receipt in receipts:
        receipt_data = ReceiptWithDetails.model_validate(receipt)
        if receipt.order:
            receipt_data.order_number = receipt.order.order_number
        if receipt.supplier:
            receipt_data.supplier_name = receipt.supplier.name
        result.append(receipt_data)

    return result


@router.get("/financial-dashboard", response_model=FinancialDashboard)
def get_financial_dashboard(
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Get financial dashboard data"""
    now = datetime.utcnow()
    current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    current_year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    # This month's spending
    month_receipts = db.query(Receipt).filter(
        Receipt.receipt_date >= current_month_start,
        Receipt.is_processed == True
    ).all()
    total_this_month = sum(r.total or 0 for r in month_receipts)

    # This year's spending
    year_receipts = db.query(Receipt).filter(
        Receipt.receipt_date >= current_year_start,
        Receipt.is_processed == True
    ).all()
    total_this_year = sum(r.total or 0 for r in year_receipts)

    # Pending orders total
    pending_orders = db.query(Order).filter(
        Order.status.in_(['submitted', 'under_review', 'approved', 'ordered'])
    ).all()
    pending_total = sum(o.estimated_total or 0 for o in pending_orders)

    # Receipts pending verification
    pending_verification = db.query(Receipt).filter(
        Receipt.is_processed == True,
        Receipt.is_manually_verified == False
    ).count()

    # Spending by supplier - group receipts by supplier for this year
    supplier_spending = {}
    for r in year_receipts:
        if r.supplier_id:
            if r.supplier_id not in supplier_spending:
                supplier = db.query(Supplier).filter(Supplier.id == r.supplier_id).first()
                supplier_spending[r.supplier_id] = {
                    'supplier_id': r.supplier_id,
                    'supplier_name': supplier.name if supplier else 'Unknown',
                    'total_spent': 0.0,
                    'receipt_count': 0
                }
            supplier_spending[r.supplier_id]['total_spent'] += r.total or 0
            supplier_spending[r.supplier_id]['receipt_count'] += 1

    spending_by_supplier = [
        SupplierSpendingSummary(
            supplier_id=data['supplier_id'],
            supplier_name=data['supplier_name'],
            total_spent=data['total_spent'],
            receipt_count=data['receipt_count'],
            avg_receipt_amount=data['total_spent'] / data['receipt_count'] if data['receipt_count'] > 0 else 0
        )
        for data in sorted(supplier_spending.values(), key=lambda x: x['total_spent'], reverse=True)
    ]

    # Spending by property - group orders/receipts by property
    property_spending = {}
    for r in year_receipts:
        if r.order and r.order.property_id:
            prop_id = r.order.property_id
            if prop_id not in property_spending:
                prop = db.query(Property).filter(Property.id == prop_id).first()
                property_spending[prop_id] = {
                    'property_id': prop_id,
                    'property_name': prop.name if prop else 'Unknown',
                    'total_spent': 0.0,
                    'receipt_count': 0,
                    'order_ids': set()
                }
            property_spending[prop_id]['total_spent'] += r.total or 0
            property_spending[prop_id]['receipt_count'] += 1
            property_spending[prop_id]['order_ids'].add(r.order_id)

    spending_by_property = [
        PropertySpendingSummary(
            property_id=data['property_id'],
            property_name=data['property_name'],
            total_spent=data['total_spent'],
            receipt_count=data['receipt_count'],
            order_count=len(data['order_ids'])
        )
        for data in sorted(property_spending.values(), key=lambda x: x['total_spent'], reverse=True)
    ]

    # Spending trend - last 6 months
    spending_trend = []
    for i in range(5, -1, -1):
        month_date = now.replace(day=1) - timedelta(days=i * 30)
        month_start = month_date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if month_start.month == 12:
            month_end = month_start.replace(year=month_start.year + 1, month=1)
        else:
            month_end = month_start.replace(month=month_start.month + 1)

        month_receipts_query = db.query(Receipt).filter(
            Receipt.receipt_date >= month_start,
            Receipt.receipt_date < month_end,
            Receipt.is_processed == True
        ).all()

        order_ids = set(r.order_id for r in month_receipts_query if r.order_id)

        spending_trend.append(SpendingByPeriod(
            period=month_start.strftime("%Y-%m"),
            total_spent=sum(r.total or 0 for r in month_receipts_query),
            receipt_count=len(month_receipts_query),
            order_count=len(order_ids)
        ))

    return FinancialDashboard(
        total_spent_this_month=total_this_month,
        total_spent_this_year=total_this_year,
        pending_orders_total=pending_total,
        receipts_pending_verification=pending_verification,
        spending_by_supplier=spending_by_supplier,
        spending_by_property=spending_by_property,
        spending_trend=spending_trend
    )


@router.post("/add-to-inventory", response_model=InventoryItemResponse)
def add_unmatched_to_inventory(
    item_data: AddUnmatchedToInventory,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """
    Add an unmatched receipt item to inventory.
    This creates a new inventory item from a receipt item that wasn't matched to existing inventory.
    """
    # Validate property exists
    property = db.query(Property).filter(Property.id == item_data.property_id).first()
    if not property:
        raise HTTPException(status_code=404, detail="Property not found")

    # Validate supplier if provided
    if item_data.supplier_id:
        supplier = db.query(Supplier).filter(Supplier.id == item_data.supplier_id).first()
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")

    # Check if item with same name already exists for this property
    existing = db.query(InventoryItem).filter(
        InventoryItem.property_id == item_data.property_id,
        InventoryItem.name == item_data.name,
        InventoryItem.is_active == True
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"An inventory item with name '{item_data.name}' already exists for this property"
        )

    # Create new inventory item
    inventory_item = InventoryItem(
        property_id=item_data.property_id,
        name=item_data.name,
        supplier_id=item_data.supplier_id,
        category=item_data.category,
        unit=item_data.unit,
        unit_price=item_data.unit_price,
        par_level=item_data.par_level,
        is_recurring=item_data.is_recurring,
        current_stock=0.0,
        is_active=True
    )

    db.add(inventory_item)
    db.commit()
    db.refresh(inventory_item)

    logger.info(f"Added new inventory item '{item_data.name}' from receipt for property {item_data.property_id}")

    return inventory_item


@router.get("/{receipt_id}", response_model=ReceiptWithDetails)
def get_receipt(
    receipt_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get receipt details"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    receipt_data = ReceiptWithDetails.model_validate(receipt)
    if receipt.order:
        receipt_data.order_number = receipt.order.order_number
    if receipt.supplier:
        receipt_data.supplier_name = receipt.supplier.name
    if receipt.uploaded_by_user:
        receipt_data.uploaded_by_name = receipt.uploaded_by_user.full_name or receipt.uploaded_by_user.email

    return receipt_data


@router.post("", response_model=ReceiptResponse, status_code=status.HTTP_201_CREATED)
def create_receipt(
    receipt_data: ReceiptCreate,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Create new receipt record"""
    receipt = Receipt(
        order_id=receipt_data.order_id,
        supplier_id=receipt_data.supplier_id,
        image_url=receipt_data.image_url,
        receipt_date=receipt_data.receipt_date,
        subtotal=receipt_data.subtotal,
        tax=receipt_data.tax,
        total=receipt_data.total,
        notes=receipt_data.notes,
        uploaded_by=current_user.id
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)

    # Update order actual total if linked
    if receipt.order_id:
        _update_order_actual_total(receipt.order_id, db)

    return receipt


@router.put("/{receipt_id}", response_model=ReceiptResponse)
def update_receipt(
    receipt_id: int,
    receipt_data: ReceiptUpdate,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Update receipt (edit extracted data, verify)"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    update_data = receipt_data.model_dump(exclude_unset=True)

    # Handle line items JSON
    if 'line_items' in update_data and update_data['line_items']:
        update_data['line_items'] = [
            item.model_dump() if hasattr(item, 'model_dump') else item
            for item in update_data['line_items']
        ]

    for key, value in update_data.items():
        setattr(receipt, key, value)

    db.commit()
    db.refresh(receipt)

    # Update order actual total if linked
    if receipt.order_id:
        _update_order_actual_total(receipt.order_id, db)

    # Update inventory prices if line items were modified
    if 'line_items' in update_data and receipt.line_items:
        _update_inventory_prices_from_receipt(receipt.line_items, db)

    return receipt


@router.post("/{receipt_id}/verify", response_model=ReceiptResponse)
def verify_receipt(
    receipt_id: int,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Mark receipt as manually verified and update inventory prices"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    receipt.is_manually_verified = True
    db.commit()
    db.refresh(receipt)

    # Update inventory prices from verified receipt data
    if receipt.line_items:
        _update_inventory_prices_from_receipt(receipt.line_items, db)

    return receipt


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receipt(
    receipt_id: int,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Delete receipt"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    order_id = receipt.order_id
    db.delete(receipt)
    db.commit()

    # Update order actual total if was linked
    if order_id:
        _update_order_actual_total(order_id, db)


@router.delete("/{receipt_id}/line-items/{item_index}", response_model=ReceiptResponse)
def delete_receipt_line_item(
    receipt_id: int,
    item_index: int,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Delete a specific line item from a receipt by its index"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    if not receipt.line_items or item_index < 0 or item_index >= len(receipt.line_items):
        raise HTTPException(status_code=404, detail="Line item not found")

    # Get the item being deleted to recalculate total
    deleted_item = receipt.line_items[item_index]
    deleted_total = deleted_item.get('total_price', 0) or 0

    # Remove the item at the given index
    new_line_items = [item for i, item in enumerate(receipt.line_items) if i != item_index]
    receipt.line_items = new_line_items

    # Recalculate receipt total
    if receipt.total and deleted_total:
        receipt.total = receipt.total - deleted_total
    if receipt.subtotal and deleted_total:
        receipt.subtotal = receipt.subtotal - deleted_total

    db.commit()
    db.refresh(receipt)

    # Update order actual total if linked
    if receipt.order_id:
        _update_order_actual_total(receipt.order_id, db)

    return receipt


def _update_order_actual_total(order_id: int, db: Session):
    """Update order's actual total from all linked receipts"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if order:
        total = sum(r.total or 0 for r in order.receipts)
        order.actual_total = total
        db.commit()
