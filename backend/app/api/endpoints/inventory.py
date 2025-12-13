from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import base64
import json
import io

from app.core.database import get_db
from app.core.config import settings
from app.core.security import (
    get_current_user, require_property_access,
    require_supervisor_or_admin, require_admin
)
from app.models.user import User, UserRole
from app.models.property import Property
from app.models.inventory import InventoryItem, InventoryCount, InventoryCountItem
from app.schemas.inventory import (
    InventoryItemCreate, InventoryItemUpdate, InventoryItemResponse, InventoryItemWithStatus,
    InventoryCountCreate, InventoryCountUpdate, InventoryCountResponse, InventoryCountWithItems,
    PrintableInventoryList, PrintableInventoryItem, InventoryCountItemWithDetails
)

router = APIRouter(prefix="/inventory", tags=["Inventory"])


# ============== INVENTORY ITEMS ==============

@router.get("/items", response_model=List[InventoryItemWithStatus])
def list_inventory_items(
    property_id: Optional[int] = None,
    category: Optional[str] = None,
    supplier_id: Optional[int] = None,
    low_stock_only: bool = False,
    skip: int = 0,
    limit: int = 200,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List inventory items for a property"""
    # Determine which property to query
    if property_id:
        require_property_access(property_id, current_user)
    elif current_user.role == UserRole.CAMP_WORKER.value:
        property_id = current_user.property_id
        if not property_id:
            raise HTTPException(status_code=400, detail="No property assigned")
    else:
        # Admin/supervisor can see all if no property specified
        pass

    query = db.query(InventoryItem).filter(InventoryItem.is_active == True)

    if property_id:
        query = query.filter(InventoryItem.property_id == property_id)
    if category:
        query = query.filter(InventoryItem.category == category)
    if supplier_id:
        query = query.filter(InventoryItem.supplier_id == supplier_id)

    items = query.order_by(InventoryItem.sort_order, InventoryItem.category, InventoryItem.name).offset(skip).limit(limit).all()

    result = []
    for item in items:
        item_dict = {
            "id": item.id,
            "property_id": item.property_id,
            "name": item.name,
            "description": item.description,
            "category": item.category,
            "brand": item.brand,
            "supplier_id": item.supplier_id,
            "unit": item.unit,
            "pack_size": item.pack_size,
            "pack_unit": item.pack_unit,
            "unit_price": item.unit_price,
            "par_level": item.par_level,
            "sort_order": item.sort_order,
            "current_stock": item.current_stock or 0,
            "avg_weekly_usage": item.avg_weekly_usage,
            "is_active": item.is_active,
            "is_recurring": item.is_recurring if item.is_recurring is not None else True,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
            "is_low_stock": item.is_low_stock(),
            "suggested_order_qty": item.suggested_order_qty(),
            "supplier_name": item.supplier.name if item.supplier else None
        }
        result.append(InventoryItemWithStatus(**item_dict))

    if low_stock_only:
        result = [r for r in result if r.is_low_stock]

    return result


@router.get("/items/categories")
def list_categories(
    property_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get distinct categories for a property"""
    if property_id:
        require_property_access(property_id, current_user)
    elif current_user.role == UserRole.CAMP_WORKER.value:
        property_id = current_user.property_id

    query = db.query(InventoryItem.category).filter(
        InventoryItem.is_active == True,
        InventoryItem.category.isnot(None)
    ).distinct()

    if property_id:
        query = query.filter(InventoryItem.property_id == property_id)

    return [c[0] for c in query.all() if c[0]]


@router.get("/items/{item_id}", response_model=InventoryItemWithStatus)
def get_inventory_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get single inventory item"""
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    require_property_access(item.property_id, current_user)

    response = InventoryItemWithStatus.model_validate(item)
    response.is_low_stock = item.is_low_stock()
    response.suggested_order_qty = item.suggested_order_qty()
    if item.supplier:
        response.supplier_name = item.supplier.name
    return response


@router.post("/items", response_model=InventoryItemResponse, status_code=status.HTTP_201_CREATED)
def create_inventory_item(
    item_data: InventoryItemCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create new inventory item (camp worker or above for their property)"""
    require_property_access(item_data.property_id, current_user)

    item = InventoryItem(**item_data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/items/{item_id}", response_model=InventoryItemResponse)
def update_inventory_item(
    item_id: int,
    item_data: InventoryItemUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update inventory item"""
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    require_property_access(item.property_id, current_user)

    update_data = item_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)

    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Soft delete inventory item (camp worker for their property, or supervisor/admin)"""
    item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Camp workers can only delete items from their own property
    require_property_access(item.property_id, current_user)

    item.is_active = False
    db.commit()


# ============== INVENTORY COUNTS ==============

@router.get("/counts", response_model=List[InventoryCountResponse])
def list_inventory_counts(
    property_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List inventory count sessions"""
    if property_id:
        require_property_access(property_id, current_user)
    elif current_user.role == UserRole.CAMP_WORKER.value:
        property_id = current_user.property_id

    query = db.query(InventoryCount)
    if property_id:
        query = query.filter(InventoryCount.property_id == property_id)

    return query.order_by(InventoryCount.count_date.desc()).offset(skip).limit(limit).all()


@router.get("/counts/{count_id}", response_model=InventoryCountWithItems)
def get_inventory_count(
    count_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get inventory count with item details"""
    count = db.query(InventoryCount).filter(InventoryCount.id == count_id).first()
    if not count:
        raise HTTPException(status_code=404, detail="Count not found")

    require_property_access(count.property_id, current_user)

    response = InventoryCountWithItems.model_validate(count)
    response.items = []

    for item in count.items:
        item_detail = InventoryCountItemWithDetails(
            id=item.id,
            inventory_item_id=item.inventory_item_id,
            quantity=item.quantity,
            notes=item.notes,
            confidence=item.confidence,
            created_at=item.created_at,
            item_name=item.inventory_item.name if item.inventory_item else "Unknown",
            item_category=item.inventory_item.category if item.inventory_item else None,
            item_unit=item.inventory_item.unit if item.inventory_item else "unit"
        )
        response.items.append(item_detail)

    return response


@router.post("/counts", response_model=InventoryCountResponse, status_code=status.HTTP_201_CREATED)
def create_inventory_count(
    count_data: InventoryCountCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create new inventory count and update stock levels (camp worker or above)"""
    require_property_access(count_data.property_id, current_user)

    count = InventoryCount(
        property_id=count_data.property_id,
        counted_by=current_user.id,
        notes=count_data.notes,
        is_finalized=True  # Auto-finalize on creation
    )
    db.add(count)
    db.flush()

    # Add count items and update stock levels
    for item_data in count_data.items:
        count_item = InventoryCountItem(
            inventory_count_id=count.id,
            inventory_item_id=item_data.inventory_item_id,
            quantity=item_data.quantity,
            notes=item_data.notes
        )
        db.add(count_item)

        # Update the inventory item's current stock
        inv_item = db.query(InventoryItem).filter(
            InventoryItem.id == item_data.inventory_item_id
        ).first()
        if inv_item:
            inv_item.current_stock = item_data.quantity

    db.commit()
    db.refresh(count)
    return count


@router.post("/counts/{count_id}/finalize", response_model=InventoryCountResponse)
def finalize_inventory_count(
    count_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Finalize inventory count and update stock levels"""
    count = db.query(InventoryCount).filter(InventoryCount.id == count_id).first()
    if not count:
        raise HTTPException(status_code=404, detail="Count not found")

    require_property_access(count.property_id, current_user)

    if count.is_finalized:
        raise HTTPException(status_code=400, detail="Count already finalized")

    # Update inventory item stock levels
    for count_item in count.items:
        inv_item = count_item.inventory_item
        if inv_item:
            inv_item.current_stock = count_item.quantity

    count.is_finalized = True
    db.commit()
    db.refresh(count)
    return count


# ============== PRINTABLE LIST ==============

@router.get("/printable/{property_id}", response_model=PrintableInventoryList)
def get_printable_inventory_list(
    property_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get printable inventory list for a property"""
    require_property_access(property_id, current_user)

    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    # Only include recurring items on the printable sheet
    items = db.query(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        InventoryItem.is_active == True,
        InventoryItem.is_recurring == True
    ).order_by(InventoryItem.category, InventoryItem.sort_order, InventoryItem.name).all()

    printable_items = [
        PrintableInventoryItem(
            name=item.name,
            category=item.category,
            unit=item.unit,
            par_level=item.par_level,
            current_stock=item.current_stock or 0
        )
        for item in items
    ]

    return PrintableInventoryList(
        property_name=prop.name,
        property_code=prop.code,
        generated_at=datetime.utcnow(),
        items=printable_items
    )


# ============== AI VISION ANALYSIS ==============

@router.post("/analyze-photos")
async def analyze_inventory_photos(
    property_id: int,
    images: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Analyze uploaded photos of inventory count sheets using OpenAI Vision.
    Supports multiple images (pages) for a single analysis.
    Returns extracted item names and quantities that can be matched to existing inventory.
    """
    require_property_access(property_id, current_user)

    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=400,
            detail="OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file."
        )

    # Get existing inventory items for this property
    inventory_items = db.query(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        InventoryItem.is_active == True
    ).all()

    if not inventory_items:
        raise HTTPException(status_code=400, detail="No inventory items found for this property")

    # Build a list of inventory item names for context
    item_list = "\n".join([f"- {item.name} (ID: {item.id}, Unit: {item.unit})" for item in inventory_items])

    try:
        import httpx
        from PIL import Image
        import pillow_heif

        # Register HEIF opener with Pillow
        pillow_heif.register_heif_opener()

        # Encode images to base64
        image_contents = []
        for img in images:
            content = await img.read()

            # Determine file extension
            ext = ""
            if img.filename:
                ext = img.filename.lower().split('.')[-1]

            # Handle HEIC/HEIF conversion to JPEG
            if ext in ('heic', 'heif'):
                # Convert HEIC to JPEG
                heic_image = Image.open(io.BytesIO(content))
                # Convert to RGB if necessary (HEIC can have alpha channel)
                if heic_image.mode in ('RGBA', 'P'):
                    heic_image = heic_image.convert('RGB')
                # Save as JPEG to bytes
                jpeg_buffer = io.BytesIO()
                heic_image.save(jpeg_buffer, format='JPEG', quality=90)
                content = jpeg_buffer.getvalue()
                media_type = "image/jpeg"
            else:
                # Determine media type for other formats
                media_type = "image/jpeg"
                if ext == 'png':
                    media_type = "image/png"
                elif ext == 'gif':
                    media_type = "image/gif"
                elif ext == 'webp':
                    media_type = "image/webp"

            b64_content = base64.b64encode(content).decode('utf-8')

            image_contents.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{media_type};base64,{b64_content}",
                    "detail": "high"
                }
            })

        # Build the prompt
        system_prompt = """You are an inventory counting assistant. Your task is to analyze photos of handwritten or printed inventory count sheets and extract item names with their counted quantities.

The inventory items in this system are:
{item_list}

Your response MUST be a valid JSON array with the following format:
[
  {{"item_id": 123, "item_name": "Item Name", "quantity": 10, "confidence": 0.95, "notes": "optional notes about this count"}},
  ...
]

Instructions:
1. Look at each photo carefully and identify item names and their associated counts
2. Match the items to the inventory list provided above. Use the item_id from the list.
3. If you can't find an exact match, try to find the closest match and note it in the notes field
4. Include a confidence score (0.0 to 1.0) for each count based on how clearly you can read it
5. If handwriting is unclear, include a note about what the value might be
6. Include ALL items you can identify across ALL photos provided
7. Return ONLY the JSON array, no other text"""

        messages = [
            {"role": "system", "content": system_prompt.format(item_list=item_list)},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Please analyze these inventory count sheet photos and extract all item counts. Return only valid JSON."},
                    *image_contents
                ]
            }
        ]

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o",
                    "messages": messages,
                    "max_completion_tokens": 4096,
                    "temperature": 0.1
                },
                timeout=120.0
            )

            if response.status_code != 200:
                error_detail = response.json() if response.content else "Unknown error"
                raise HTTPException(
                    status_code=500,
                    detail=f"OpenAI API error: {error_detail}"
                )

            result = response.json()
            content = result['choices'][0]['message']['content']

            # Try to parse the JSON from the response
            # Remove markdown code blocks if present
            content = content.strip()
            if content.startswith('```json'):
                content = content[7:]
            if content.startswith('```'):
                content = content[3:]
            if content.endswith('```'):
                content = content[:-3]
            content = content.strip()

            try:
                extracted_counts = json.loads(content)
            except json.JSONDecodeError as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to parse AI response as JSON: {str(e)}. Raw response: {content[:500]}"
                )

            return {
                "success": True,
                "extracted_counts": extracted_counts,
                "images_processed": len(images)
            }

    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"HTTP error calling OpenAI: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing photos: {str(e)}")


# ============== SEED INVENTORY FROM PHOTO (ADMIN ONLY) ==============

VALID_CATEGORIES = ['Dairy', 'Protein', 'Produce', 'Dry Goods', 'Canned/Jarred', 'Beverages', 'Condiments', 'Other']
VALID_UNITS = ['each', 'lb', 'oz', 'gallon', 'quart', 'pint', 'case', 'box', 'bag', 'dozen', 'bunch', 'head', 'jar', 'can', 'bottle', 'pack', 'roll', 'sheet', 'unit']

@router.post("/seed-from-photo")
async def seed_inventory_from_photo(
    property_id: int,
    images: List[UploadFile] = File(...),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Admin-only: Analyze uploaded photos of inventory sheets and extract items to seed the inventory.
    Cross-references existing inventory to avoid duplicates.
    New items are marked as recurring by default.
    """
    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=400,
            detail="OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file."
        )

    # Verify property exists
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    # Get existing inventory items for this property (for duplicate checking)
    existing_items = db.query(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        InventoryItem.is_active == True
    ).all()

    existing_names = [item.name.lower().strip() for item in existing_items]
    existing_items_list = "\n".join([f"- {item.name}" for item in existing_items]) if existing_items else "No existing items"

    try:
        import httpx
        from PIL import Image
        import pillow_heif

        # Register HEIF opener with Pillow
        pillow_heif.register_heif_opener()

        # Encode images to base64
        image_contents = []
        for img in images:
            content = await img.read()

            # Determine file extension
            ext = ""
            if img.filename:
                ext = img.filename.lower().split('.')[-1]

            # Handle HEIC/HEIF conversion to JPEG
            if ext in ('heic', 'heif'):
                heic_image = Image.open(io.BytesIO(content))
                if heic_image.mode in ('RGBA', 'P'):
                    heic_image = heic_image.convert('RGB')
                jpeg_buffer = io.BytesIO()
                heic_image.save(jpeg_buffer, format='JPEG', quality=90)
                content = jpeg_buffer.getvalue()
                media_type = "image/jpeg"
            else:
                media_type = "image/jpeg"
                if ext == 'png':
                    media_type = "image/png"
                elif ext == 'gif':
                    media_type = "image/gif"
                elif ext == 'webp':
                    media_type = "image/webp"

            b64_content = base64.b64encode(content).decode('utf-8')
            image_contents.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{media_type};base64,{b64_content}",
                    "detail": "high"
                }
            })

        categories_list = ", ".join(VALID_CATEGORIES)
        units_list = ", ".join(VALID_UNITS)

        # Build the prompt for extracting inventory items
        system_prompt = f"""You are an inventory extraction assistant. Your task is to analyze photos of inventory sheets and extract ALL item names you can see.

IMPORTANT: This is for SEEDING a new inventory list, not for counting quantities. Focus on extracting ITEM NAMES only.

The valid categories are: {categories_list}
The valid units are: {units_list}

Existing items in this camp's inventory (DO NOT include these - they already exist):
{existing_items_list}

Your response MUST be a valid JSON array with the following format:
[
  {{"name": "Item Name", "unit": "unit type", "category": "Category Name", "par_level": null}},
  ...
]

Instructions:
1. Extract EVERY item name you can read from the inventory sheet(s)
2. DO NOT include items that already exist in the existing items list above (check carefully for matches)
3. For each item, try to determine:
   - name: The item name (be specific, e.g., "Whole Milk" not just "Milk")
   - unit: MUST be one of these valid units: {units_list}. Choose the most appropriate unit based on the item type. Default to "each" if not visible or uncertain.
   - category: Assign to one of these categories: {categories_list}. Use your best judgment based on the item name.
   - par_level: Leave as null unless you can clearly see a par level number
4. Be thorough - extract ALL items visible in the photos
5. Skip any item that closely matches an existing item name (even if spelled slightly differently)
6. Return ONLY the JSON array, no other text"""

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Please analyze these inventory sheet photos and extract all item names. Return only valid JSON array of items."},
                    *image_contents
                ]
            }
        ]

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o",
                    "messages": messages,
                    "max_completion_tokens": 16384,  # Increased to handle large inventory sheets (100+ items)
                    "temperature": 0.1
                },
                timeout=180.0  # Increased timeout for larger responses
            )

            if response.status_code != 200:
                error_detail = response.json() if response.content else "Unknown error"
                raise HTTPException(
                    status_code=500,
                    detail=f"OpenAI API error: {error_detail}"
                )

            result = response.json()
            content = result['choices'][0]['message']['content']

            # Parse JSON from response
            content = content.strip()
            if content.startswith('```json'):
                content = content[7:]
            if content.startswith('```'):
                content = content[3:]
            if content.endswith('```'):
                content = content[:-3]
            content = content.strip()

            try:
                extracted_items = json.loads(content)
            except json.JSONDecodeError as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to parse AI response as JSON: {str(e)}. Raw response: {content[:500]}"
                )

            # Filter out duplicates (double-check against existing items)
            new_items = []
            skipped_duplicates = []

            for item in extracted_items:
                item_name = item.get('name', '').strip()
                if not item_name:
                    continue

                # Check for duplicates (case-insensitive)
                item_name_lower = item_name.lower()
                is_duplicate = False

                for existing_name in existing_names:
                    # Check for exact match or very similar names
                    if item_name_lower == existing_name or \
                       item_name_lower in existing_name or \
                       existing_name in item_name_lower:
                        is_duplicate = True
                        skipped_duplicates.append(item_name)
                        break

                if not is_duplicate:
                    # Validate category
                    category = item.get('category', 'Other')
                    if category not in VALID_CATEGORIES:
                        category = 'Other'

                    # Validate unit
                    unit = item.get('unit', 'each')
                    if unit not in VALID_UNITS:
                        unit = 'each'

                    new_items.append({
                        "name": item_name,
                        "unit": unit,
                        "category": category,
                        "par_level": item.get('par_level')
                    })
                    # Add to existing names to prevent duplicates within this batch
                    existing_names.append(item_name_lower)

            return {
                "success": True,
                "property_id": property_id,
                "property_name": prop.name,
                "extracted_items": new_items,
                "skipped_duplicates": skipped_duplicates,
                "total_extracted": len(new_items),
                "total_skipped": len(skipped_duplicates),
                "images_processed": len(images)
            }

    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"HTTP error calling OpenAI: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing photos: {str(e)}")


@router.post("/seed-confirm")
async def confirm_seed_inventory(
    property_id: int,
    items: List[dict],
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Admin-only: Confirm and create the extracted inventory items.
    Items should be the extracted_items array from seed-from-photo.
    """
    # Verify property exists
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    # Get existing items again to double-check for duplicates
    existing_items = db.query(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        InventoryItem.is_active == True
    ).all()
    existing_names = set(item.name.lower().strip() for item in existing_items)

    created_items = []
    skipped_items = []

    for item_data in items:
        item_name = item_data.get('name', '').strip()
        if not item_name:
            continue

        # Final duplicate check
        if item_name.lower() in existing_names:
            skipped_items.append(item_name)
            continue

        # Validate category
        category = item_data.get('category', 'Other')
        if category not in VALID_CATEGORIES:
            category = 'Other'

        # Validate unit
        unit = item_data.get('unit', 'each')
        if unit not in VALID_UNITS:
            unit = 'each'

        # Create the inventory item
        new_item = InventoryItem(
            property_id=property_id,
            name=item_name,
            unit=unit,
            category=category,
            par_level=item_data.get('par_level'),
            current_stock=0,
            is_recurring=True,  # Default to recurring since it's from an existing inventory sheet
            is_active=True,
            supplier_id=None  # No supplier info from photo
        )
        db.add(new_item)
        created_items.append(item_name)
        existing_names.add(item_name.lower())

    db.commit()

    return {
        "success": True,
        "property_id": property_id,
        "property_name": prop.name,
        "created_count": len(created_items),
        "created_items": created_items,
        "skipped_count": len(skipped_items),
        "skipped_items": skipped_items
    }
