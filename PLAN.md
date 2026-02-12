# Intelligent Inventory Sorting System

## Overview
Implement AI-powered intelligent sorting of inventory items within categories. Items like "sliced cheeses" should be grouped together, "pies" together, etc. Sorting results are saved and only re-run when new items are added to a category.

## Current State
- `InventoryItem` model already has a `sort_order` field (integer, default 0)
- Items are queried with: `ORDER BY sort_order, category, name`
- The Print Form currently sorts alphabetically within categories
- OpenAI integration (GPT-4o) is already established in the codebase

## Implementation Plan

### 1. Add Tracking for Unsorted Items
**File: `backend/app/models/inventory.py`**
- Add `last_sorted_at` field to track when an item was last included in a sort
- New items will have `last_sorted_at = NULL`, indicating they need sorting

### 2. Create AI Sorting Endpoint
**File: `backend/app/api/endpoints/inventory.py`**

Add endpoint `POST /inventory/sort-category`:
- Input: `property_id`, `category` (optional - sort all if not specified)
- Process:
  1. Get all items in the category/property
  2. Check if any items have `last_sorted_at = NULL` (new items)
  3. If no new items and force=false, skip sorting
  4. Send item names to GPT-4o with prompt to logically group similar items
  5. Receive ordered list of item IDs
  6. Update `sort_order` (1, 2, 3...) and `last_sorted_at` for all items
- Returns: List of sorted item IDs

**AI Prompt Strategy:**
```
Given these food inventory items, return them in a logical order that groups similar items together.
Group similar products (e.g., all cheeses together, all pies together, all canned goods together).
Within groups, order alphabetically or by size/type.

Items:
- Cheddar Cheese Sliced
- Apple Pie
- Swiss Cheese Sliced
- Pumpkin Pie
- Mozzarella Sticks
- Cherry Pie

Return as JSON array of item names in the optimal order.
```

### 3. Auto-Sort on Print Form Generation
**File: `backend/app/api/endpoints/inventory.py`**

Add endpoint `GET /inventory/printable-list`:
- Before returning items, check each category for unsorted items (`last_sorted_at = NULL`)
- For categories with new items, trigger AI sort for that category
- Return fully sorted list for printing

### 4. Frontend Integration
**File: `frontend/src/app/inventory/page.tsx`**

Modify `handleExportForm`:
1. Call new `/inventory/printable-list?property_id={id}` endpoint
2. This returns pre-sorted items (AI sorting happens server-side)
3. Use the `sort_order` from the response instead of alphabetical sorting

**Optional: Manual Resort Button**
- Add "Re-sort Items" button in admin section
- Calls sort endpoint with `force=true` to re-sort all categories

### 5. Database Migration
Create Alembic migration to add `last_sorted_at` column:
```python
# Add column
op.add_column('inventory_items',
    sa.Column('last_sorted_at', sa.DateTime(timezone=True), nullable=True)
)
```

## Data Flow

```
New Item Added → sort_order=0, last_sorted_at=NULL
        ↓
Print Form Requested
        ↓
Check categories for items with last_sorted_at=NULL
        ↓
Found? → Send category items to AI for sorting
        ↓
AI returns optimal order
        ↓
Update sort_order (1,2,3...) and last_sorted_at for ALL items in category
        ↓
Return sorted items for printing
```

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/inventory/sort-category` | POST | Manually trigger AI sort for a category |
| `/inventory/printable-list` | GET | Get sorted list (auto-sorts categories with new items) |
| `/inventory/sorting-status` | GET | Check which categories need sorting |

## Considerations

1. **Cost Efficiency**: Only sort categories that have new items (not the whole inventory)
2. **Consistency**: Once sorted, items maintain their position until new items are added
3. **Performance**: AI sorting happens asynchronously; cache results in `sort_order` field
4. **Fallback**: If AI fails, fall back to alphabetical sorting
5. **Subcategories**: For categories with subcategories (like Beverages), sort within each subcategory

## Estimated Effort
- Backend changes: ~150 lines
- Frontend changes: ~50 lines
- Migration: ~10 lines
