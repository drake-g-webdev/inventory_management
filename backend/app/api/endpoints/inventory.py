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
    limit: int = 1000,
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
            "subcategory": item.subcategory,
            "brand": item.brand,
            "supplier_id": item.supplier_id,
            "unit": item.unit,
            "pack_size": item.pack_size,
            "pack_unit": item.pack_unit,
            "order_unit": item.order_unit,
            "units_per_order_unit": item.units_per_order_unit,
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
            "supplier_name": item.supplier.name if item.supplier else None,
            "effective_order_unit": item.get_effective_order_unit()
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
        import fitz  # PyMuPDF for PDF support

        # Register HEIF opener with Pillow
        pillow_heif.register_heif_opener()

        # Build the prompt
        system_prompt = """You are an inventory counting assistant. Your task is to analyze a photo of a handwritten or printed inventory count sheet and extract item names with their counted quantities.

The inventory items in this system are:
{item_list}

Your response MUST be a valid JSON array with the following format:
[
  {{"item_id": 123, "item_name": "Item Name", "quantity": 10.5, "confidence": 0.95, "notes": "optional notes about this count"}},
  ...
]

CRITICAL INSTRUCTIONS:
1. PRESERVE DECIMAL/FRACTIONAL COUNTS EXACTLY as written - do NOT round! If someone wrote "1.5", return 1.5. If they wrote ".5" or "0.5", return 0.5.
2. DO NOT round up or down - report the EXACT number written on the sheet
3. Look carefully for decimal points - a "." before a number means it's a fraction (e.g., ".5" = 0.5)
4. Common partial counts: 0.5, 1.5, 2.5, 0.25, 0.75 - these are valid and should be preserved
5. Match the items to the inventory list provided above. Use the item_id from the list.
6. If you can't find an exact match, try to find the closest match and note it in the notes field
7. Include a confidence score (0.0 to 1.0) for each count based on how clearly you can read it
8. If handwriting is unclear, include a note about what the value might be
9. Extract EVERY item you can see in the photo - do not skip any items
10. Return ONLY the JSON array, no other text

IMPORTANT: The quantity field accepts decimals. A count of "1.5" means one and a half units - this is common in inventory. Never interpret ".5" as "5" - that would be a decimal point before the 5."""

        # Collect all image data (bytes, media_type) to process
        # This allows us to handle PDFs by extracting pages as images
        image_data_list = []  # List of (bytes, media_type, page_label)

        for img in images:
            content = await img.read()

            # Determine file extension
            ext = ""
            if img.filename:
                ext = img.filename.lower().split('.')[-1]

            # Handle PDF files - extract each page as an image
            if ext == 'pdf':
                try:
                    pdf_doc = fitz.open(stream=content, filetype="pdf")
                    for page_num in range(len(pdf_doc)):
                        page = pdf_doc[page_num]
                        # Render page at 2x resolution for better quality (150 DPI -> 300 DPI effective)
                        mat = fitz.Matrix(2.0, 2.0)
                        pix = page.get_pixmap(matrix=mat)
                        # Convert to PNG bytes
                        png_bytes = pix.tobytes("png")
                        image_data_list.append((png_bytes, "image/png", f"{img.filename} page {page_num + 1}"))
                    pdf_doc.close()
                except Exception as pdf_error:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Failed to process PDF '{img.filename}': {str(pdf_error)}"
                    )
            # Handle HEIC/HEIF conversion to JPEG
            elif ext in ('heic', 'heif'):
                heic_image = Image.open(io.BytesIO(content))
                if heic_image.mode in ('RGBA', 'P'):
                    heic_image = heic_image.convert('RGB')
                jpeg_buffer = io.BytesIO()
                heic_image.save(jpeg_buffer, format='JPEG', quality=90)
                image_data_list.append((jpeg_buffer.getvalue(), "image/jpeg", img.filename))
            else:
                # Determine media type for other formats
                media_type = "image/jpeg"
                if ext == 'png':
                    media_type = "image/png"
                elif ext == 'gif':
                    media_type = "image/gif"
                elif ext == 'webp':
                    media_type = "image/webp"
                image_data_list.append((content, media_type, img.filename))

        # Process pages in PARALLEL to avoid timeout
        all_extracted_counts = []
        total_pages = len(image_data_list)

        async def process_single_page(client, img_index, img_bytes, media_type, page_label):
            """Process a single page and return extracted counts"""
            b64_content = base64.b64encode(img_bytes).decode('utf-8')

            image_content = {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{media_type};base64,{b64_content}",
                    "detail": "high"
                }
            }

            messages = [
                {"role": "system", "content": system_prompt.format(item_list=item_list)},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"Please analyze this inventory count sheet ({page_label}, page {img_index + 1} of {total_pages}) and extract ALL item counts. Return only valid JSON."},
                        image_content
                    ]
                }
            ]

            try:
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
                    print(f"OpenAI API error on {page_label}: {response.status_code}")
                    return []

                result = response.json()
                response_content = result['choices'][0]['message']['content']

                # Try to parse the JSON from the response
                # Remove markdown code blocks if present
                response_content = response_content.strip()
                if response_content.startswith('```json'):
                    response_content = response_content[7:]
                if response_content.startswith('```'):
                    response_content = response_content[3:]
                if response_content.endswith('```'):
                    response_content = response_content[:-3]
                response_content = response_content.strip()

                page_counts = json.loads(response_content)
                if isinstance(page_counts, list):
                    print(f"Successfully extracted {len(page_counts)} items from {page_label}")
                    return page_counts
                return []
            except json.JSONDecodeError as e:
                print(f"Failed to parse AI response for {page_label}: {str(e)}")
                return []
            except Exception as e:
                print(f"Error processing {page_label}: {str(e)}")
                return []

        # Process all pages in parallel
        import asyncio
        async with httpx.AsyncClient() as client:
            tasks = [
                process_single_page(client, idx, img_bytes, media_type, page_label)
                for idx, (img_bytes, media_type, page_label) in enumerate(image_data_list)
            ]
            results = await asyncio.gather(*tasks)
            for page_counts in results:
                all_extracted_counts.extend(page_counts)

        # Merge duplicates: if same item_id appears multiple times, keep the one with higher confidence
        merged_counts = {}
        for count in all_extracted_counts:
            item_id = count.get('item_id')
            if item_id is None:
                continue
            if item_id not in merged_counts:
                merged_counts[item_id] = count
            else:
                # Keep the one with higher confidence
                existing_confidence = merged_counts[item_id].get('confidence', 0)
                new_confidence = count.get('confidence', 0)
                if new_confidence > existing_confidence:
                    merged_counts[item_id] = count

        extracted_counts = list(merged_counts.values())

        return {
            "success": True,
            "extracted_counts": extracted_counts,
            "images_processed": len(images),
            "pages_processed": total_pages
        }

    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"HTTP error calling OpenAI: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing photos: {str(e)}")


# ============== SEED INVENTORY FROM PHOTO (ADMIN ONLY) ==============

VALID_CATEGORIES = ['Bakery', 'Beverages', 'Cleaning Supplies', 'Condiments', 'Dairy', 'Dry Goods', 'Frozen', 'Packaged Snacks', 'Paper & Plastic Goods', 'Produce', 'Protein', 'Spices', 'Other']
VALID_UNITS = ['Each', 'Lb', 'Oz', 'Gallon', 'Quart', 'Pint', 'Case', 'Box', 'Bag', 'Dozen', 'Bunch', 'Head', 'Jar', 'Can', 'Bottle', 'Pack', 'Roll', 'Sheet', 'Unit']

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

        # Helper function to convert PDF to images (same as in admin.py)
        def convert_pdf_to_images(pdf_content: bytes) -> list:
            """Convert PDF pages to base64-encoded PNG images for OpenAI Vision API"""
            import fitz  # PyMuPDF

            pdf_images = []
            pdf_doc = fitz.open(stream=pdf_content, filetype="pdf")

            for page_num in range(len(pdf_doc)):
                page = pdf_doc[page_num]
                # Render at 2x resolution for better OCR
                mat = fitz.Matrix(2.0, 2.0)
                pix = page.get_pixmap(matrix=mat)

                # Convert to PNG bytes
                img_bytes = pix.tobytes("png")
                img_base64 = base64.b64encode(img_bytes).decode("utf-8")
                pdf_images.append(img_base64)

                # Limit to first 10 pages for inventory sheets
                if page_num >= 9:
                    break

            pdf_doc.close()
            return pdf_images

        # Encode images to base64
        image_contents = []
        for img in images:
            content = await img.read()

            # Determine file extension
            ext = ""
            if img.filename:
                ext = img.filename.lower().split('.')[-1]

            # Handle PDF files - convert pages to images
            if ext == 'pdf':
                try:
                    pdf_page_images = convert_pdf_to_images(content)
                    for page_b64 in pdf_page_images:
                        image_contents.append({
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{page_b64}",
                                "detail": "high"
                            }
                        })
                    continue  # Skip to next file
                except Exception as pdf_err:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Failed to process PDF file: {str(pdf_err)}"
                    )

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


# ============== AI-POWERED INVENTORY SORTING ==============

async def _sort_category_with_ai(items: List[InventoryItem], category: str, subcategory: Optional[str] = None) -> List[int]:
    """
    Use AI to sort items within a category/subcategory logically.
    Returns list of item IDs in the optimal order.
    """
    import httpx

    if not settings.OPENAI_API_KEY:
        # Fallback to alphabetical if no API key
        return [item.id for item in sorted(items, key=lambda x: x.name.lower())]

    if not items:
        return []

    # Build list of items for AI
    item_names = [{"id": item.id, "name": item.name} for item in items]

    category_desc = f"{category}"
    if subcategory:
        category_desc = f"{category} > {subcategory}"

    system_prompt = f"""You are an inventory organization assistant. Your task is to sort food/supply inventory items within a category in a logical order that groups similar items together.

Category: {category_desc}

Rules for sorting:
1. Group similar products together (e.g., all sliced cheeses together, all pies together, all canned goods by type)
2. Within groups, order alphabetically or by size/type
3. For beverages: group by type (sodas, juices, water, coffee, etc.)
4. For dairy: group by type (milk, cheese, butter, yogurt, etc.)
5. For produce: group by type (fruits together, vegetables together)
6. For proteins: group by type (beef, chicken, pork, fish, etc.)
7. For condiments: group by type (sauces, dressings, spreads, etc.)
8. Think about how a camp cook would want to find items quickly

Return ONLY a JSON array of item IDs in the optimal order, e.g.: [5, 2, 8, 1, 3]
Do not include any other text or explanation."""

    user_content = f"Please sort these {len(item_names)} inventory items in a logical order:\n\n"
    user_content += json.dumps(item_names, indent=2)

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content}
                    ],
                    "max_completion_tokens": 4096,
                    "temperature": 0.1
                },
                timeout=60.0
            )

            if response.status_code != 200:
                # Fallback to alphabetical
                return [item.id for item in sorted(items, key=lambda x: x.name.lower())]

            result = response.json()
            content = result['choices'][0]['message']['content'].strip()

            # Parse the JSON array
            if content.startswith('```json'):
                content = content[7:]
            if content.startswith('```'):
                content = content[3:]
            if content.endswith('```'):
                content = content[:-3]
            content = content.strip()

            sorted_ids = json.loads(content)

            # Validate that all IDs are present
            item_id_set = set(item.id for item in items)
            if set(sorted_ids) != item_id_set:
                # AI returned invalid IDs, fallback to alphabetical
                return [item.id for item in sorted(items, key=lambda x: x.name.lower())]

            return sorted_ids

    except Exception as e:
        print(f"AI sorting failed: {str(e)}, falling back to alphabetical")
        return [item.id for item in sorted(items, key=lambda x: x.name.lower())]


@router.post("/sort-category")
async def sort_inventory_category(
    property_id: int,
    category: Optional[str] = None,
    subcategory: Optional[str] = None,
    force: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    AI-powered sorting for inventory items within a category.
    Only sorts if there are new items (last_sorted_at = NULL) unless force=True.
    If no category specified, sorts all categories that have new items.
    """
    require_property_access(property_id, current_user)

    # Build query for items
    query = db.query(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        InventoryItem.is_active == True,
        InventoryItem.is_recurring == True
    )

    if category:
        query = query.filter(InventoryItem.category == category)
    if subcategory:
        query = query.filter(InventoryItem.subcategory == subcategory)

    all_items = query.all()

    if not all_items:
        return {"success": True, "message": "No items to sort", "sorted_categories": []}

    # Group items by category and subcategory
    grouped_items = {}
    for item in all_items:
        key = (item.category or "Uncategorized", item.subcategory or "")
        if key not in grouped_items:
            grouped_items[key] = []
        grouped_items[key].append(item)

    sorted_categories = []
    now = datetime.utcnow()

    for (cat, subcat), items in grouped_items.items():
        # Check if sorting is needed (any items with last_sorted_at = NULL)
        needs_sorting = force or any(item.last_sorted_at is None for item in items)

        if not needs_sorting:
            continue

        # Get AI-sorted order
        sorted_ids = await _sort_category_with_ai(items, cat, subcat if subcat else None)

        # Update sort_order and last_sorted_at for all items
        for order, item_id in enumerate(sorted_ids, start=1):
            item = next((i for i in items if i.id == item_id), None)
            if item:
                item.sort_order = order
                item.last_sorted_at = now

        sorted_categories.append({
            "category": cat,
            "subcategory": subcat or None,
            "items_sorted": len(sorted_ids)
        })

    db.commit()

    return {
        "success": True,
        "sorted_categories": sorted_categories,
        "total_items_sorted": sum(c["items_sorted"] for c in sorted_categories)
    }


@router.get("/sorting-status")
def get_sorting_status(
    property_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Check which categories have unsorted items (need AI sorting).
    """
    require_property_access(property_id, current_user)

    # Get all recurring items grouped by category
    items = db.query(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        InventoryItem.is_active == True,
        InventoryItem.is_recurring == True
    ).all()

    # Group by category and check for unsorted items
    categories = {}
    for item in items:
        cat_key = item.category or "Uncategorized"
        if cat_key not in categories:
            categories[cat_key] = {"total": 0, "unsorted": 0, "subcategories": {}}

        categories[cat_key]["total"] += 1
        if item.last_sorted_at is None:
            categories[cat_key]["unsorted"] += 1

        # Track subcategories
        if item.subcategory:
            if item.subcategory not in categories[cat_key]["subcategories"]:
                categories[cat_key]["subcategories"][item.subcategory] = {"total": 0, "unsorted": 0}
            categories[cat_key]["subcategories"][item.subcategory]["total"] += 1
            if item.last_sorted_at is None:
                categories[cat_key]["subcategories"][item.subcategory]["unsorted"] += 1

    result = []
    for cat, data in categories.items():
        result.append({
            "category": cat,
            "total_items": data["total"],
            "unsorted_items": data["unsorted"],
            "needs_sorting": data["unsorted"] > 0,
            "subcategories": [
                {
                    "name": name,
                    "total_items": subdata["total"],
                    "unsorted_items": subdata["unsorted"],
                    "needs_sorting": subdata["unsorted"] > 0
                }
                for name, subdata in data["subcategories"].items()
            ]
        })

    return {
        "property_id": property_id,
        "categories": result,
        "total_unsorted": sum(c["unsorted_items"] for c in result)
    }


@router.get("/printable-list")
async def get_printable_list_with_sorting(
    property_id: int,
    auto_sort: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get printable inventory list with automatic AI sorting for categories with new items.
    This endpoint checks each category for unsorted items and triggers AI sorting before returning.
    """
    require_property_access(property_id, current_user)

    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    # Get all recurring items
    items = db.query(InventoryItem).filter(
        InventoryItem.property_id == property_id,
        InventoryItem.is_active == True,
        InventoryItem.is_recurring == True
    ).all()

    if not items:
        return {
            "property_name": prop.name,
            "property_code": prop.code,
            "generated_at": datetime.utcnow(),
            "items": [],
            "categories_sorted": []
        }

    categories_sorted = []

    if auto_sort:
        # Group items by category/subcategory
        grouped_items = {}
        for item in items:
            key = (item.category or "Uncategorized", item.subcategory or "")
            if key not in grouped_items:
                grouped_items[key] = []
            grouped_items[key].append(item)

        now = datetime.utcnow()

        # Sort each category that has unsorted items
        for (cat, subcat), category_items in grouped_items.items():
            needs_sorting = any(item.last_sorted_at is None for item in category_items)

            if needs_sorting:
                sorted_ids = await _sort_category_with_ai(category_items, cat, subcat if subcat else None)

                for order, item_id in enumerate(sorted_ids, start=1):
                    item = next((i for i in category_items if i.id == item_id), None)
                    if item:
                        item.sort_order = order
                        item.last_sorted_at = now

                categories_sorted.append({
                    "category": cat,
                    "subcategory": subcat or None,
                    "items_sorted": len(sorted_ids)
                })

        if categories_sorted:
            db.commit()

        # ALWAYS re-query items with proper ordering by sort_order
        items = db.query(InventoryItem).filter(
            InventoryItem.property_id == property_id,
            InventoryItem.is_active == True,
            InventoryItem.is_recurring == True
        ).order_by(
            InventoryItem.category,
            InventoryItem.subcategory,
            InventoryItem.sort_order,
            InventoryItem.name
        ).all()
    else:
        items = sorted(items, key=lambda x: (x.category or "", x.subcategory or "", x.sort_order, x.name.lower()))

    # Build printable list
    printable_items = [
        {
            "id": item.id,
            "name": item.name,
            "category": item.category,
            "subcategory": item.subcategory,
            "unit": item.unit,
            "par_level": item.par_level,
            "current_stock": item.current_stock or 0,
            "sort_order": item.sort_order
        }
        for item in items
    ]

    return {
        "property_name": prop.name,
        "property_code": prop.code,
        "generated_at": datetime.utcnow(),
        "items": printable_items,
        "categories_sorted": categories_sorted,
        "total_items": len(printable_items)
    }
