#!/usr/bin/env python3
"""
Export inventory items to CSV for backup purposes.
Usage: python -m scripts.export_inventory [--property-code CODE] [--output FILE]
"""

import csv
import sys
import os
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.models.inventory import InventoryItem
from app.models.property import Property
from app.models.supplier import Supplier


def export_inventory_to_csv(
    db: Session,
    property_code: str = None,
    output_file: str = None
) -> str:
    """
    Export inventory items to CSV file.

    Args:
        db: Database session
        property_code: Optional property code to filter by (e.g., 'YRC')
        output_file: Output file path (auto-generated if not provided)

    Returns:
        Path to the generated CSV file
    """
    # Build query
    query = db.query(InventoryItem).join(
        Property, InventoryItem.property_id == Property.id
    ).outerjoin(
        Supplier, InventoryItem.supplier_id == Supplier.id
    )

    if property_code:
        query = query.filter(Property.code == property_code)

    items = query.all()

    if not items:
        print(f"No inventory items found" + (f" for property code '{property_code}'" if property_code else ""))
        return None

    # Generate output filename if not provided
    if not output_file:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        suffix = f"_{property_code}" if property_code else "_all"
        output_file = f"inventory_export{suffix}_{timestamp}.csv"

    # Define CSV columns
    columns = [
        'id',
        'property_id',
        'property_code',
        'property_name',
        'name',
        'description',
        'category',
        'subcategory',
        'brand',
        'product_notes',
        'supplier_id',
        'supplier_name',
        'unit',
        'order_unit',
        'units_per_order_unit',
        'pack_size',
        'pack_unit',
        'unit_price',
        'par_level',
        'current_stock',
        'avg_weekly_usage',
        'sort_order',
        'is_recurring',
        'is_active',
        'created_at',
        'updated_at'
    ]

    # Write CSV
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()

        for item in items:
            row = {
                'id': item.id,
                'property_id': item.property_id,
                'property_code': item.camp_property.code if item.camp_property else '',
                'property_name': item.camp_property.name if item.camp_property else '',
                'name': item.name,
                'description': item.description or '',
                'category': item.category or '',
                'subcategory': item.subcategory or '',
                'brand': item.brand or '',
                'product_notes': item.product_notes or '',
                'supplier_id': item.supplier_id or '',
                'supplier_name': item.supplier.name if item.supplier else '',
                'unit': item.unit,
                'order_unit': item.order_unit or '',
                'units_per_order_unit': item.units_per_order_unit or '',
                'pack_size': item.pack_size or '',
                'pack_unit': item.pack_unit or '',
                'unit_price': item.unit_price or '',
                'par_level': item.par_level or '',
                'current_stock': item.current_stock or 0,
                'avg_weekly_usage': item.avg_weekly_usage or '',
                'sort_order': item.sort_order or 0,
                'is_recurring': item.is_recurring,
                'is_active': item.is_active,
                'created_at': item.created_at.isoformat() if item.created_at else '',
                'updated_at': item.updated_at.isoformat() if item.updated_at else ''
            }
            writer.writerow(row)

    print(f"Exported {len(items)} items to {output_file}")
    return output_file


def main():
    import argparse

    parser = argparse.ArgumentParser(description='Export inventory items to CSV')
    parser.add_argument('--property-code', '-p', help='Property code to filter by (e.g., YRC)')
    parser.add_argument('--output', '-o', help='Output CSV file path')
    parser.add_argument('--list-properties', '-l', action='store_true', help='List all properties')

    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.list_properties:
            properties = db.query(Property).filter(Property.is_active == True).all()
            print("\nAvailable properties:")
            print("-" * 40)
            for prop in properties:
                item_count = db.query(InventoryItem).filter(
                    InventoryItem.property_id == prop.id
                ).count()
                print(f"  {prop.code}: {prop.name} ({item_count} items)")
            print()
            return

        export_inventory_to_csv(
            db,
            property_code=args.property_code,
            output_file=args.output
        )
    finally:
        db.close()


if __name__ == '__main__':
    main()
