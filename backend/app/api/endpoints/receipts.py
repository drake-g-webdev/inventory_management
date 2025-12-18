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
from app.models.inventory import InventoryItem, ReceiptCodeAlias
from app.schemas.receipt import (
    ReceiptCreate, ReceiptUpdate, ReceiptResponse, ReceiptWithDetails,
    ReceiptLineItem, FinancialDashboard, SupplierSpendingSummary,
    PropertySpendingSummary, SpendingByPeriod, ReceiptExtractionResult,
    UnmatchedReceiptItem, AddUnmatchedToInventory, ReceiptCodeAliasCreate,
    ReceiptCodeAliasResponse, MatchReceiptItemRequest
)
from app.schemas.inventory import InventoryItemResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/receipts", tags=["Receipts"])


# ============== HELPER FUNCTIONS ==============

async def extract_receipt_with_ai(
    image_content: bytes,
    order_items: List[dict],
    property_name: str = None,
    property_code: str = None,
    supplier_parsing_prompt: str = None,
    receipt_aliases: List[dict] = None,
    user_instructions: str = None
) -> ReceiptExtractionResult:
    """Use OpenAI Vision to extract receipt data and match to order items.

    Args:
        image_content: The image bytes
        order_items: List of order items to match against
        property_name: Name of the property for filtering
        property_code: Code of the property for filtering
        supplier_parsing_prompt: Supplier-specific parsing instructions (e.g., Costco format)
        receipt_aliases: List of known receipt code aliases for matching
        user_instructions: Custom instructions from the user (e.g., "yellow highlighted items are for this property")
    """
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

        # Build receipt aliases context if available
        aliases_context = ""
        if receipt_aliases:
            aliases_list = "\n".join([
                f"- \"{alias['receipt_code']}\" → Inventory Item ID {alias['inventory_item_id']} ({alias.get('item_name', 'Unknown')})"
                for alias in receipt_aliases[:50]  # Limit to 50 aliases
            ])
            aliases_context = f"""
KNOWN RECEIPT CODE ALIASES:
These receipt codes have been previously matched to inventory items. Use these for matching:
{aliases_list}

If you see any of these codes on the receipt, use the matched_inventory_item_id field with the corresponding ID.
"""

        # Build supplier-specific parsing instructions
        supplier_specific = ""
        if supplier_parsing_prompt:
            supplier_specific = f"""
=== SUPPLIER-SPECIFIC PARSING INSTRUCTIONS ===
{supplier_parsing_prompt}
=== END SUPPLIER-SPECIFIC INSTRUCTIONS ===

"""

        # Build user instructions section
        user_instructions_section = ""
        if user_instructions:
            user_instructions_section = f"""
=== IMPORTANT: USER INSTRUCTIONS ===
The user has provided the following special instructions for processing this receipt:
"{user_instructions}"

Follow these instructions carefully! Common examples:
- "Yellow highlighted items are for this property" → Only extract items with yellow highlighting
- "Ignore blue items" → Skip/exclude any items marked in blue
- "Only first page items" → Focus on items from the first receipt/page
=== END USER INSTRUCTIONS ===

"""

        system_prompt = f"""You are a meticulous receipt data extraction specialist. ACCURACY IS PARAMOUNT - take your time and verify every number.
{user_instructions_section}{supplier_specific}

=== CRITICAL: MULTIPLE RECEIPTS DETECTION ===
IMPORTANT: The image may contain MULTIPLE RECEIPTS (e.g., two Costco receipts side by side, or receipts from different transactions).
You MUST:
1. SCAN THE ENTIRE IMAGE for ALL receipts present
2. Look for visual separations: different receipt headers, gaps, different transaction numbers, different dates/times
3. Extract items from ALL receipts found, not just the first or most visible one
4. If there are 2+ receipts, combine ALL line items from ALL receipts into the single response
5. For totals: sum the totals from all receipts together

=== METHODOLOGY: SLOW, CAREFUL, ITEM-BY-ITEM EXTRACTION ===

You MUST follow this exact process. Do not rush. Accuracy is more important than speed.

**PHASE 1: RECEIPT HEADER IDENTIFICATION**
1. SCAN THE ENTIRE IMAGE first - look for multiple receipt headers/logos
2. Count how many separate receipts are in the image
3. For each receipt: identify the store name (Costco, Walmart, Sam's Club, Sysco, US Foods, Restaurant Depot, Charlie's Produce, etc.)
4. Find the receipt date(s) - use the most recent if multiple receipts
5. Note: The store name is a LOGO or HEADER, not an item being purchased

{property_context}

**PHASE 2: LINE ITEM EXTRACTION (ONE AT A TIME)**
For EACH line item on the receipt, perform these steps IN ORDER:

Step A - Read the item name character by character
Step B - Find the quantity column for this row
Step C - Find the unit price column for this row
Step D - Find the total/extended price column for this row
Step E - VERIFY: Does quantity × unit_price = total_price? (within rounding)
         - If NO: Re-read the numbers more carefully
         - Common errors: confusing 1 and 7, 5 and 6, 3 and 8, decimal placement

CRITICAL - DISCOUNTS AND CREDITS:
- Look for lines with negative amounts, "DISCOUNT", "OFF", "CREDIT", "SAVINGS", "-$", or amounts in parentheses
- These are discounts and MUST be captured as line items with NEGATIVE total_price values
- Example: "INSTANT SAVINGS -$6.00" should have total_price: -6.00
- Example: "COUPON ($3.50)" should have total_price: -3.50
- Discounts often appear right after or below the item they apply to

CRITICAL PRICE VERIFICATION:
- Look at each digit individually
- Check decimal point placement (is it $12.99 or $1.29 or $129.90?)
- Verify the math: qty × unit_price should equal total_price
- If a price seems unusually high or low for the item type, double-check it

**PHASE 3: RECEIPT TOTALS VERIFICATION**
1. Extract subtotal, tax, and total from the receipt
2. VERIFY: Sum of all line item totals should approximately equal subtotal
3. VERIFY: subtotal + tax should equal total
4. If verification fails, re-check your extracted values

**PHASE 4: ORDER MATCHING**
Match extracted items to these order items:
{order_items_str}

Matching rules:
- Abbreviated names match full names ("PORK TENDER" = "Pork Tenderloins")
- Partial matches are valid ("EGGS" = "Large Eggs")
- Quantity descriptors don't prevent matching ("5DZ EGGS" = "Eggs")

{aliases_context}

**PHASE 5: FINAL SELF-CHECK**
Before returning your response, verify:
□ Every price has the correct decimal placement
□ Quantities make sense (not accidentally reading price as quantity)
□ Line totals = quantity × unit price (allow for rounding)
□ All line totals sum approximately to subtotal
□ Subtotal + tax = total

=== OUTPUT FORMAT ===
Return a JSON object with this structure:
{{
    "supplier_name": "Store name from header",
    "receipt_date": "YYYY-MM-DD or null (use most recent if multiple receipts)",
    "subtotal": number or null (SUM of all receipts if multiple),
    "tax": number or null (SUM of all receipts if multiple),
    "total": number or null (SUM of all receipts if multiple),
    "receipts_found": number (how many separate receipts were in the image - IMPORTANT!),
    "verification_notes": "Brief notes including: number of receipts found, any items difficult to read",
    "line_items": [
        {{
            "item_name": "exactly as printed on receipt",
            "quantity": number,
            "unit_price": number or null,
            "total_price": number or null (USE NEGATIVE VALUES FOR DISCOUNTS!),
            "is_discount": true/false (true if this is a discount/savings/credit line),
            "price_verified": true/false (did qty × unit_price = total?),
            "matched_order_item_id": order_item_id or null,
            "matched_inventory_item_id": inventory_item_id or null
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
    "confidence_score": 0.0 to 1.0 (lower if any prices couldn't be verified)
}}

CRITICAL MATH CHECK BEFORE RETURNING:
1. Add up ALL line_items total_price values (including negative discounts)
2. This sum should equal subtotal (within $0.10)
3. subtotal + tax should equal total (within $0.10)
4. If the math doesn't work, you missed a discount or misread a price - go back and check!

REMEMBER: It's better to mark a price as uncertain than to guess wrong. If you can't clearly read a number, note it in verification_notes and lower your confidence score."""

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
                            "text": """Please extract all items from this receipt image following the 5-phase methodology.

FIRST: Scan the ENTIRE image to check if there are MULTIPLE RECEIPTS.
- Look for 2+ receipt headers, different transaction numbers, or visual separations
- If multiple receipts exist, extract items from ALL of them
- Report how many receipts you found in the "receipts_found" field

THEN: For each line item across ALL receipts:
1. Read the item name
2. Find and verify the quantity
3. Find and verify the unit price (check decimal placement!)
4. Find and verify the total price
5. Confirm: qty × unit_price = total_price

After extracting all items from ALL receipts, verify that your line item totals sum to approximately the combined subtotal.

Return the data as JSON with the price_verified field for each item."""
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
            max_completion_tokens=4096,
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

        # Server-side validation of extracted data
        verification_issues = []

        # Convert to schema with validation
        line_items = []
        calculated_subtotal = 0.0

        for item in result_data.get("line_items", []):
            qty = float(item["quantity"]) if item.get("quantity") else None
            unit_price = float(item["unit_price"]) if item.get("unit_price") else None
            total_price = float(item["total_price"]) if item.get("total_price") else None
            item_name = item.get("item_name", "Unknown Item")

            # Validation 1: Check if qty × unit_price ≈ total_price
            if qty and unit_price and total_price:
                expected_total = qty * unit_price
                # Allow 2% tolerance for rounding
                if abs(expected_total - total_price) > (total_price * 0.02 + 0.02):
                    verification_issues.append(
                        f"Math mismatch for '{item_name}': {qty} × ${unit_price:.2f} = ${expected_total:.2f}, but receipt shows ${total_price:.2f}"
                    )
                    logger.warning(f"Price verification failed for {item_name}: {qty} × {unit_price} = {expected_total}, got {total_price}")

            # Validation 2: Flag suspiciously high unit prices (over $500)
            if unit_price and unit_price > 500:
                verification_issues.append(f"Unusually high unit price for '{item_name}': ${unit_price:.2f}")

            # Validation 3: Flag if quantity looks like it might be a price (decimal with 2 places > 1)
            if qty and qty > 1 and str(qty).count('.') == 1:
                decimal_part = str(qty).split('.')[1] if '.' in str(qty) else ''
                if len(decimal_part) == 2 and float(f"0.{decimal_part}") > 0:
                    # Quantity like 12.99 might actually be a price
                    if unit_price and unit_price < 5 and total_price and total_price > 50:
                        verification_issues.append(f"'{item_name}': quantity {qty} may actually be a price")

            if total_price:
                calculated_subtotal += total_price

            line_items.append(ReceiptLineItem(
                item_name=item_name,
                quantity=qty,
                unit_price=unit_price,
                total_price=total_price,
                matched_order_item_id=item.get("matched_order_item_id"),
                matched_inventory_item_id=item.get("matched_inventory_item_id")
            ))

        # Validation 4: STRICT MATH CHECK - Line items must sum to subtotal (or total minus tax)
        reported_subtotal = float(result_data["subtotal"]) if result_data.get("subtotal") else None
        reported_total = float(result_data["total"]) if result_data.get("total") else None
        reported_tax = float(result_data["tax"]) if result_data.get("tax") else 0.0

        # Calculate what the subtotal should be based on total - tax
        expected_subtotal_from_total = (reported_total - reported_tax) if reported_total else None

        # Use a strict $1.00 tolerance for the math check
        math_tolerance = 1.00

        if calculated_subtotal > 0:
            difference_from_subtotal = abs(calculated_subtotal - reported_subtotal) if reported_subtotal else None
            difference_from_total_calc = abs(calculated_subtotal - expected_subtotal_from_total) if expected_subtotal_from_total else None

            # Check against reported subtotal
            if difference_from_subtotal and difference_from_subtotal > math_tolerance:
                verification_issues.append(
                    f"⚠️ MATH ERROR: Line items sum to ${calculated_subtotal:.2f}, but subtotal is ${reported_subtotal:.2f} (difference: ${difference_from_subtotal:.2f}). Missing discount or wrong price?"
                )
                logger.warning(f"Receipt math error: items sum ${calculated_subtotal:.2f} vs subtotal ${reported_subtotal:.2f}")

            # Also check against total - tax as a secondary verification
            if difference_from_total_calc and difference_from_total_calc > math_tolerance:
                verification_issues.append(
                    f"⚠️ MATH ERROR: Line items sum to ${calculated_subtotal:.2f}, but total(${reported_total:.2f}) - tax(${reported_tax:.2f}) = ${expected_subtotal_from_total:.2f} (difference: ${difference_from_total_calc:.2f})"
                )

        # Validation 5: Verify subtotal + tax = total
        if reported_subtotal and reported_total:
            expected_total = reported_subtotal + reported_tax
            if abs(expected_total - reported_total) > 0.10:
                verification_issues.append(
                    f"Tax math issue: ${reported_subtotal:.2f} + ${reported_tax:.2f} = ${expected_total:.2f}, but total shown is ${reported_total:.2f}"
                )

        # Log any verification issues
        if verification_issues:
            logger.warning(f"Receipt verification issues: {verification_issues}")

        # Adjust confidence score based on verification
        base_confidence = float(result_data.get("confidence_score", 0.8))
        if verification_issues:
            # Reduce confidence by 10% for each issue, minimum 0.3
            confidence_penalty = len(verification_issues) * 0.1
            adjusted_confidence = max(0.3, base_confidence - confidence_penalty)
        else:
            adjusted_confidence = base_confidence

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

        # Include verification notes in raw_text for debugging
        verification_info = ""
        if verification_issues:
            verification_info = f"\n\n=== SERVER VALIDATION ISSUES ===\n" + "\n".join(verification_issues)

        return ReceiptExtractionResult(
            supplier_name=result_data.get("supplier_name"),
            receipt_date=receipt_date,
            subtotal=float(result_data["subtotal"]) if result_data.get("subtotal") else None,
            tax=float(result_data["tax"]) if result_data.get("tax") else None,
            total=float(result_data["total"]) if result_data.get("total") else None,
            line_items=line_items,
            unmatched_items=unmatched_items,
            confidence_score=adjusted_confidence,
            raw_text=result_text + verification_info,
            validation_errors=verification_issues,
            calculated_total=calculated_subtotal if calculated_subtotal > 0 else None
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


async def detect_supplier_from_image(image_content: bytes) -> Optional[str]:
    """Quick first-pass to detect supplier name from receipt image."""
    if not settings.OPENAI_API_KEY:
        return None

    try:
        import openai
        client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)

        image_base64 = base64.standard_b64encode(image_content).decode("utf-8")

        if image_content[:8] == b'\x89PNG\r\n\x1a\n':
            media_type = "image/png"
        elif image_content[:2] == b'\xff\xd8':
            media_type = "image/jpeg"
        else:
            media_type = "image/jpeg"

        response = client.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {
                    "role": "system",
                    "content": """Look at the TOP of this receipt and identify the store/supplier name.
Return ONLY a JSON object with one field: {"supplier_name": "Store Name"}
Examples: Costco, Walmart, Sysco, US Foods, Restaurant Depot, Charlie's Produce"""
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "What store is this receipt from?"},
                        {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_base64}"}}
                    ]
                }
            ],
            max_completion_tokens=100,
            response_format={"type": "json_object"}
        )

        result = json.loads(response.choices[0].message.content)
        return result.get("supplier_name")
    except Exception as e:
        logger.warning(f"Could not detect supplier from image: {e}")
        return None


def match_supplier_by_name(supplier_name: str, db: Session) -> Optional[Supplier]:
    """Match a supplier name string to a Supplier record."""
    if not supplier_name:
        return None

    suppliers = db.query(Supplier).filter(Supplier.is_active == True).all()
    detected_lower = supplier_name.lower().strip()

    # First try exact match
    for supplier in suppliers:
        if supplier.name.lower().strip() == detected_lower:
            return supplier

    # Then try partial match
    for supplier in suppliers:
        supplier_name_lower = supplier.name.lower()
        if detected_lower in supplier_name_lower or supplier_name_lower in detected_lower:
            return supplier

    return None


def get_receipt_aliases_for_matching(supplier_id: Optional[int], property_id: int, db: Session) -> List[dict]:
    """Get receipt code aliases for a supplier to help with matching."""
    query = db.query(ReceiptCodeAlias).join(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        ReceiptCodeAlias.is_active == True
    )

    if supplier_id:
        # Get aliases for this specific supplier OR aliases without supplier (global)
        query = query.filter(
            (ReceiptCodeAlias.supplier_id == supplier_id) | (ReceiptCodeAlias.supplier_id == None)
        )

    aliases = query.all()
    return [
        {
            "receipt_code": alias.receipt_code,
            "inventory_item_id": alias.inventory_item_id,
            "item_name": alias.inventory_item.name if alias.inventory_item else None,
            "supplier_id": alias.supplier_id,
            "unit_price": alias.unit_price
        }
        for alias in aliases
    ]


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
    property_id = None
    if order.camp_property:
        property_name = order.camp_property.name
        property_code = order.camp_property.code
        property_id = order.camp_property.id

    # STEP 1: Quick first-pass to detect supplier for supplier-specific processing
    detected_supplier_name = await detect_supplier_from_image(content)
    logger.info(f"First-pass supplier detection: {detected_supplier_name}")

    # Match to existing supplier
    matched_supplier = match_supplier_by_name(detected_supplier_name, db) if detected_supplier_name else None
    supplier_parsing_prompt = None
    receipt_aliases = []

    if matched_supplier:
        logger.info(f"Matched supplier: {matched_supplier.name} (ID: {matched_supplier.id})")
        # Get supplier-specific parsing prompt if available
        supplier_parsing_prompt = matched_supplier.receipt_parsing_prompt
        if supplier_parsing_prompt:
            logger.info(f"Using supplier-specific parsing prompt for {matched_supplier.name}")

        # Get receipt code aliases for this supplier
        if property_id:
            receipt_aliases = get_receipt_aliases_for_matching(matched_supplier.id, property_id, db)
            logger.info(f"Found {len(receipt_aliases)} receipt code aliases for matching")

    # STEP 2: Full extraction with supplier-specific context and user instructions
    extracted_data = await extract_receipt_with_ai(
        content,
        order_items,
        property_name,
        property_code,
        supplier_parsing_prompt=supplier_parsing_prompt,
        receipt_aliases=receipt_aliases,
        user_instructions=notes  # Pass notes as AI instructions
    )

    # Save image to uploads directory
    uploads_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads", "receipts")
    os.makedirs(uploads_dir, exist_ok=True)

    # Use .jpg extension if HEIC was converted, otherwise use original extension
    file_ext = ".jpg" if is_heic else (os.path.splitext(file.filename)[1] if file.filename else ".jpg")
    filename = f"{uuid.uuid4().hex}{file_ext}"
    file_path = os.path.join(uploads_dir, filename)

    with open(file_path, "wb") as f:
        f.write(content)

    # Use supplier from first-pass detection, or try to match from full extraction
    supplier_id = matched_supplier.id if matched_supplier else None

    # If first-pass didn't find supplier, try matching from full extraction result
    if not supplier_id and extracted_data.supplier_name:
        fallback_supplier = match_supplier_by_name(extracted_data.supplier_name, db)
        if fallback_supplier:
            supplier_id = fallback_supplier.id
            logger.info(f"Matched supplier from full extraction: {fallback_supplier.name}")
        else:
            logger.warning(f"Could not match detected supplier '{extracted_data.supplier_name}' to any existing supplier")

    # Final fallback to order's supplier if no supplier detected at all
    if not supplier_id and not detected_supplier_name and not extracted_data.supplier_name:
        if order.items and order.items[0].supplier_id:
            supplier_id = order.items[0].supplier_id
            logger.info(f"Using fallback supplier from order item")

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
    # Include property_id from the order for inventory matching
    if order.property_id:
        receipt_data.property_id = order.property_id
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


def _resolve_receipt_item_names(receipt: Receipt, db: Session) -> ReceiptWithDetails:
    """
    Resolve matched order/inventory item names for a receipt's line items.
    Returns a ReceiptWithDetails with resolved names.
    """
    receipt_data = ReceiptWithDetails.model_validate(receipt)

    if receipt.order:
        receipt_data.order_number = receipt.order.order_number
        if receipt.order.property_id:
            receipt_data.property_id = receipt.order.property_id
            # Get property name
            prop = db.query(Property).filter(Property.id == receipt.order.property_id).first()
            if prop:
                receipt_data.property_name = prop.name
    if receipt.supplier:
        receipt_data.supplier_name = receipt.supplier.name
    if receipt.uploaded_by_user:
        receipt_data.uploaded_by_name = receipt.uploaded_by_user.full_name or receipt.uploaded_by_user.email

    # Resolve order/inventory item names for line items
    if receipt.line_items:
        resolved_items = []
        for item in receipt.line_items:
            item_data = item if isinstance(item, dict) else item.copy()

            # Look up order item name if matched to order
            if item_data.get('matched_order_item_id'):
                order_item = db.query(OrderItem).filter(
                    OrderItem.id == item_data['matched_order_item_id']
                ).first()
                if order_item:
                    # Use the item_name property which handles inventory vs custom items
                    item_data['matched_order_item_name'] = order_item.item_name

            # Look up inventory item name if matched to inventory (but no order item name yet)
            if item_data.get('matched_inventory_item_id') and not item_data.get('matched_order_item_name'):
                inventory_item = db.query(InventoryItem).filter(
                    InventoryItem.id == item_data['matched_inventory_item_id']
                ).first()
                if inventory_item:
                    item_data['matched_order_item_name'] = inventory_item.name

            resolved_items.append(item_data)

        receipt_data.line_items = resolved_items
        receipt_data.parsed_line_items = [ReceiptLineItem(**item) for item in resolved_items]

    return receipt_data


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
        result.append(_resolve_receipt_item_names(receipt, db))

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
    from sqlalchemy import or_

    now = datetime.utcnow()
    current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    current_year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    # This month's spending - use receipt_date if available, otherwise created_at
    # Include receipts that are either processed OR manually verified
    month_receipts = db.query(Receipt).filter(
        or_(Receipt.is_processed == True, Receipt.is_manually_verified == True),
        or_(
            Receipt.receipt_date >= current_month_start,
            # If no receipt_date, fall back to created_at
            (Receipt.receipt_date.is_(None)) & (Receipt.created_at >= current_month_start)
        )
    ).all()
    total_this_month = sum(r.total or 0 for r in month_receipts)

    # This year's spending - use receipt_date if available, otherwise created_at
    # Include receipts that are either processed OR manually verified
    year_receipts = db.query(Receipt).filter(
        or_(Receipt.is_processed == True, Receipt.is_manually_verified == True),
        or_(
            Receipt.receipt_date >= current_year_start,
            # If no receipt_date, fall back to created_at
            (Receipt.receipt_date.is_(None)) & (Receipt.created_at >= current_year_start)
        )
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

        # Use receipt_date if available, otherwise created_at
        # Include receipts that are either processed OR manually verified
        month_receipts_query = db.query(Receipt).filter(
            or_(Receipt.is_processed == True, Receipt.is_manually_verified == True),
            or_(
                (Receipt.receipt_date >= month_start) & (Receipt.receipt_date < month_end),
                # If no receipt_date, fall back to created_at
                (Receipt.receipt_date.is_(None)) & (Receipt.created_at >= month_start) & (Receipt.created_at < month_end)
            )
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


@router.get("/search-inventory", response_model=List[InventoryItemResponse])
def search_inventory_for_matching(
    property_id: int,
    q: str,
    limit: int = 20,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """
    Search inventory items for matching to a receipt item.
    Returns items that match the search query by name, category, or brand.
    """
    query = db.query(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        InventoryItem.is_active == True
    )

    # Search by name, category, subcategory, or brand
    search_term = f"%{q}%"
    query = query.filter(
        (InventoryItem.name.ilike(search_term)) |
        (InventoryItem.category.ilike(search_term)) |
        (InventoryItem.subcategory.ilike(search_term)) |
        (InventoryItem.brand.ilike(search_term))
    )

    items = query.order_by(InventoryItem.name).limit(limit).all()
    return items


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
        # Include property_id from the order for inventory matching
        if receipt.order.property_id:
            receipt_data.property_id = receipt.order.property_id
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


@router.put("/{receipt_id}/line-items/{item_index}", response_model=ReceiptWithDetails)
def update_receipt_line_item(
    receipt_id: int,
    item_index: int,
    item_data: dict,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Update a specific line item (quantity, unit_price, total_price) by its index"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    if not receipt.line_items or item_index < 0 or item_index >= len(receipt.line_items):
        raise HTTPException(status_code=404, detail="Line item not found")

    # Get the current line item
    line_item = receipt.line_items[item_index].copy() if isinstance(receipt.line_items[item_index], dict) else dict(receipt.line_items[item_index])
    old_total = line_item.get('total_price', 0) or 0

    # Update allowed fields
    if 'quantity' in item_data and item_data['quantity'] is not None:
        line_item['quantity'] = float(item_data['quantity'])
    if 'unit_price' in item_data and item_data['unit_price'] is not None:
        line_item['unit_price'] = float(item_data['unit_price'])
    if 'total_price' in item_data and item_data['total_price'] is not None:
        line_item['total_price'] = float(item_data['total_price'])

    new_total = line_item.get('total_price', 0) or 0

    # Update the line items list
    new_line_items = list(receipt.line_items)
    new_line_items[item_index] = line_item
    receipt.line_items = new_line_items

    # Adjust receipt totals if line item total changed
    total_diff = new_total - old_total
    if total_diff != 0:
        if receipt.subtotal:
            receipt.subtotal = receipt.subtotal + total_diff
        if receipt.total:
            receipt.total = receipt.total + total_diff

    db.commit()
    db.refresh(receipt)

    logger.info(f"Updated line item {item_index} for receipt {receipt_id}")

    # Update order actual total if linked
    if receipt.order_id:
        _update_order_actual_total(receipt.order_id, db)

    # Return with resolved item names
    return _resolve_receipt_item_names(receipt, db)


@router.delete("/{receipt_id}/line-items/{item_index}", response_model=ReceiptWithDetails)
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

    # Return with resolved item names
    return _resolve_receipt_item_names(receipt, db)


def _update_order_actual_total(order_id: int, db: Session):
    """Update order's actual total from all linked receipts"""
    order = db.query(Order).filter(Order.id == order_id).first()
    if order:
        total = sum(r.total or 0 for r in order.receipts)
        order.actual_total = total
        db.commit()


# ============== RECEIPT CODE ALIAS ENDPOINTS ==============

@router.post("/match-item", response_model=ReceiptCodeAliasResponse)
def match_receipt_item_to_inventory(
    match_request: MatchReceiptItemRequest,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """
    Match a receipt item code to an inventory item and save the alias for future matching.
    This is called when a user manually matches an unmatched receipt item.
    If receipt_id is provided, also updates the receipt's line_item to show as matched.
    """
    # Validate inventory item exists
    inventory_item = db.query(InventoryItem).filter(
        InventoryItem.id == match_request.inventory_item_id
    ).first()
    if not inventory_item:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    # Check if alias already exists
    existing = db.query(ReceiptCodeAlias).filter(
        ReceiptCodeAlias.receipt_code == match_request.receipt_code,
        ReceiptCodeAlias.inventory_item_id == match_request.inventory_item_id,
        ReceiptCodeAlias.supplier_id == match_request.supplier_id
    ).first()

    if existing:
        # Update existing alias
        existing.match_count += 1
        existing.last_seen = datetime.utcnow()
        if match_request.unit_price:
            existing.unit_price = match_request.unit_price
        db.commit()
        db.refresh(existing)
        alias = existing
    else:
        # Create new alias
        alias = ReceiptCodeAlias(
            inventory_item_id=match_request.inventory_item_id,
            supplier_id=match_request.supplier_id,
            receipt_code=match_request.receipt_code,
            unit_price=match_request.unit_price,
            last_seen=datetime.utcnow(),
            match_count=1
        )
        db.add(alias)
        db.commit()
        db.refresh(alias)

    logger.info(f"Saved receipt alias: '{match_request.receipt_code}' -> inventory item {inventory_item.name}")

    # If receipt_id provided, update the receipt's line item to show as matched
    if match_request.receipt_id:
        receipt = db.query(Receipt).filter(Receipt.id == match_request.receipt_id).first()
        if receipt and receipt.line_items:
            updated_items = []
            for item in receipt.line_items:
                item_data = item if isinstance(item, dict) else item.copy()
                # Match by item_name (receipt_code)
                item_name = item_data.get('item_name') or item_data.get('name', '')
                if item_name.upper() == match_request.receipt_code.upper():
                    item_data['matched_inventory_item_id'] = match_request.inventory_item_id
                    item_data['matched_order_item_name'] = inventory_item.name
                    logger.info(f"Updated receipt {receipt.id} line item '{item_name}' with matched inventory item {inventory_item.name}")
                updated_items.append(item_data)
            receipt.line_items = updated_items
            db.commit()
            db.refresh(receipt)

    # Build response with related info
    return ReceiptCodeAliasResponse(
        id=alias.id,
        inventory_item_id=alias.inventory_item_id,
        supplier_id=alias.supplier_id,
        receipt_code=alias.receipt_code,
        unit_price=alias.unit_price,
        last_seen=alias.last_seen,
        match_count=alias.match_count,
        is_active=alias.is_active,
        created_at=alias.created_at,
        item_name=inventory_item.name,
        supplier_name=alias.supplier.name if alias.supplier else None
    )


@router.get("/aliases/{property_id}", response_model=List[ReceiptCodeAliasResponse])
def list_receipt_aliases(
    property_id: int,
    supplier_id: Optional[int] = None,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """List all receipt code aliases for a property, optionally filtered by supplier."""
    query = db.query(ReceiptCodeAlias).join(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        ReceiptCodeAlias.is_active == True
    )

    if supplier_id:
        query = query.filter(ReceiptCodeAlias.supplier_id == supplier_id)

    aliases = query.order_by(ReceiptCodeAlias.match_count.desc()).all()

    return [
        ReceiptCodeAliasResponse(
            id=alias.id,
            inventory_item_id=alias.inventory_item_id,
            supplier_id=alias.supplier_id,
            receipt_code=alias.receipt_code,
            unit_price=alias.unit_price,
            last_seen=alias.last_seen,
            match_count=alias.match_count,
            is_active=alias.is_active,
            created_at=alias.created_at,
            item_name=alias.inventory_item.name if alias.inventory_item else None,
            supplier_name=alias.supplier.name if alias.supplier else None
        )
        for alias in aliases
    ]


@router.delete("/aliases/{alias_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receipt_alias(
    alias_id: int,
    current_user: User = Depends(require_purchasing_team),
    db: Session = Depends(get_db)
):
    """Delete a receipt code alias."""
    alias = db.query(ReceiptCodeAlias).filter(ReceiptCodeAlias.id == alias_id).first()
    if not alias:
        raise HTTPException(status_code=404, detail="Alias not found")

    db.delete(alias)
    db.commit()
