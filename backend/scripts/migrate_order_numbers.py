"""
Migration script to convert order numbers to new format.
Changes from: ORD-{date}-{uuid}
To: {property_code}-{YYYYMMDD}

Example: ORD-20251215-ABC123 -> YRC-20251215

Run from the backend directory:
    python -m scripts.migrate_order_numbers
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.models.order import Order
from app.models.property import Property


def migrate_order_numbers():
    db = SessionLocal()

    try:
        # Get all orders with their properties
        orders = db.query(Order).all()

        if not orders:
            print("No orders found to migrate.")
            return

        print(f"Found {len(orders)} orders to migrate...")

        # Build a property code cache
        properties = db.query(Property).all()
        property_code_map = {p.id: p.code for p in properties}

        migrated_count = 0
        skipped_count = 0

        for order in orders:
            old_number = order.order_number

            # Check if already migrated (doesn't start with "ORD-")
            if not old_number.startswith("ORD-"):
                print(f"  Skipping {old_number} - already in new format")
                skipped_count += 1
                continue

            # Get property code
            property_code = property_code_map.get(order.property_id)
            if not property_code:
                print(f"  Warning: Order {order.id} has no valid property, skipping")
                skipped_count += 1
                continue

            # Use the order's creation date for the new number
            date_str = order.created_at.strftime('%Y%m%d')
            new_number = f"{property_code}-{date_str}"

            print(f"  {old_number} -> {new_number}")
            order.order_number = new_number
            migrated_count += 1

        db.commit()
        print(f"\nMigration complete!")
        print(f"  Migrated: {migrated_count}")
        print(f"  Skipped: {skipped_count}")

    except Exception as e:
        db.rollback()
        print(f"Error during migration: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print("Starting order number migration...")
    migrate_order_numbers()
