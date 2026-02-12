"""
Seed script for SUKAKPAK Purchasing Management System
Creates admin user, test property, suppliers, and inventory items
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal, engine, Base
from app.core.security import get_password_hash
from app.models.user import User, UserRole
from app.models.property import Property
from app.models.supplier import Supplier
from app.models.inventory import InventoryItem


def seed_data():
    db = SessionLocal()

    try:
        # Check if data already exists
        if db.query(User).first():
            print("Data already seeded. Skipping...")
            return

        print("Creating database tables...")
        Base.metadata.create_all(bind=engine)

        # Create Properties (Camps)
        print("Creating properties...")
        properties = [
            Property(name="Main Camp", code="MAIN", address="123 Main Camp Road"),
            Property(name="North Camp", code="NORTH", address="456 North Camp Trail"),
            Property(name="South Camp", code="SOUTH", address="789 South Camp Drive"),
        ]
        for prop in properties:
            db.add(prop)
        db.commit()

        main_camp = properties[0]
        north_camp = properties[1]
        south_camp = properties[2]

        # Create Users
        print("Creating users...")
        users = [
            User(
                email="admin@sukakpak.com",
                hashed_password=get_password_hash("admin123"),
                full_name="System Administrator",
                role=UserRole.ADMIN.value,
                property_id=None
            ),
            User(
                email="supervisor@sukakpak.com",
                hashed_password=get_password_hash("super123"),
                full_name="John Supervisor",
                role=UserRole.PURCHASING_SUPERVISOR.value,
                property_id=None
            ),
            User(
                email="purchasing@sukakpak.com",
                hashed_password=get_password_hash("purchase123"),
                full_name="Jane Purchasing",
                role=UserRole.PURCHASING_TEAM.value,
                property_id=None
            ),
            User(
                email="maincamp@sukakpak.com",
                hashed_password=get_password_hash("camp123"),
                full_name="Mike Main Camp",
                role=UserRole.CAMP_WORKER.value,
                property_id=main_camp.id
            ),
            User(
                email="northcamp@sukakpak.com",
                hashed_password=get_password_hash("camp123"),
                full_name="Nancy North Camp",
                role=UserRole.CAMP_WORKER.value,
                property_id=north_camp.id
            ),
        ]
        for user in users:
            db.add(user)
        db.commit()

        # Create Suppliers
        print("Creating suppliers...")
        suppliers = [
            Supplier(name="Sysco", contact_name="Sales Team", email="sales@sysco.com", phone="555-SYSCO"),
            Supplier(name="US Foods", contact_name="Account Manager", email="orders@usfoods.com", phone="555-USFOOD"),
            Supplier(name="Costco Business", contact_name="Business Center", email="business@costco.com", phone="555-COSTCO"),
            Supplier(name="Restaurant Depot", contact_name="Customer Service", email="orders@restaurantdepot.com"),
            Supplier(name="Local Produce Co", contact_name="Farm Direct", email="orders@localproduce.com"),
        ]
        for supplier in suppliers:
            db.add(supplier)
        db.commit()

        sysco = suppliers[0]
        usfoods = suppliers[1]
        costco = suppliers[2]
        local_produce = suppliers[4]

        # Create Inventory Items for Main Camp
        print("Creating inventory items...")
        inventory_items = [
            # Dairy
            InventoryItem(property_id=main_camp.id, name="Whole Milk", category="Dairy", unit="gallon", par_level=10, supplier_id=sysco.id, unit_price=4.50),
            InventoryItem(property_id=main_camp.id, name="2% Milk", category="Dairy", unit="gallon", par_level=8, supplier_id=sysco.id, unit_price=4.25),
            InventoryItem(property_id=main_camp.id, name="Heavy Cream", category="Dairy", unit="quart", par_level=4, supplier_id=sysco.id, unit_price=6.00),
            InventoryItem(property_id=main_camp.id, name="Butter", category="Dairy", unit="lb", par_level=10, supplier_id=sysco.id, unit_price=5.50),
            InventoryItem(property_id=main_camp.id, name="Cheddar Cheese", category="Dairy", unit="lb", par_level=8, supplier_id=sysco.id, unit_price=6.75),
            InventoryItem(property_id=main_camp.id, name="Eggs (Large)", category="Dairy", unit="case", par_level=5, supplier_id=sysco.id, unit_price=35.00),
            # Proteins
            InventoryItem(property_id=main_camp.id, name="Ground Beef 80/20", category="Protein", unit="lb", par_level=30, supplier_id=usfoods.id, unit_price=5.25),
            InventoryItem(property_id=main_camp.id, name="Chicken Breast", category="Protein", unit="lb", par_level=40, supplier_id=usfoods.id, unit_price=4.50),
            InventoryItem(property_id=main_camp.id, name="Bacon", category="Protein", unit="lb", par_level=15, supplier_id=sysco.id, unit_price=7.50),
            InventoryItem(property_id=main_camp.id, name="Hot Dogs", category="Protein", unit="pack", par_level=10, supplier_id=costco.id, unit_price=8.00),
            # Produce
            InventoryItem(property_id=main_camp.id, name="Potatoes", category="Produce", unit="lb", par_level=50, supplier_id=local_produce.id, unit_price=0.75),
            InventoryItem(property_id=main_camp.id, name="Onions", category="Produce", unit="lb", par_level=20, supplier_id=local_produce.id, unit_price=0.85),
            InventoryItem(property_id=main_camp.id, name="Lettuce (Romaine)", category="Produce", unit="head", par_level=12, supplier_id=local_produce.id, unit_price=2.25),
            InventoryItem(property_id=main_camp.id, name="Tomatoes", category="Produce", unit="lb", par_level=15, supplier_id=local_produce.id, unit_price=2.00),
            InventoryItem(property_id=main_camp.id, name="Apples", category="Produce", unit="lb", par_level=20, supplier_id=local_produce.id, unit_price=1.50),
            InventoryItem(property_id=main_camp.id, name="Bananas", category="Produce", unit="lb", par_level=20, supplier_id=local_produce.id, unit_price=0.65),
            # Dry Goods
            InventoryItem(property_id=main_camp.id, name="All-Purpose Flour", category="Dry Goods", unit="lb", par_level=25, supplier_id=sysco.id, unit_price=0.50),
            InventoryItem(property_id=main_camp.id, name="Sugar", category="Dry Goods", unit="lb", par_level=20, supplier_id=sysco.id, unit_price=0.65),
            InventoryItem(property_id=main_camp.id, name="Rice (Long Grain)", category="Dry Goods", unit="lb", par_level=25, supplier_id=sysco.id, unit_price=0.90),
            InventoryItem(property_id=main_camp.id, name="Pasta (Spaghetti)", category="Dry Goods", unit="lb", par_level=15, supplier_id=sysco.id, unit_price=1.25),
            InventoryItem(property_id=main_camp.id, name="Bread (White)", category="Dry Goods", unit="loaf", par_level=10, supplier_id=sysco.id, unit_price=2.50),
            InventoryItem(property_id=main_camp.id, name="Hamburger Buns", category="Dry Goods", unit="pack", par_level=10, supplier_id=sysco.id, unit_price=3.50),
            # Canned
            InventoryItem(property_id=main_camp.id, name="Tomato Sauce", category="Canned/Jarred", unit="can", par_level=20, supplier_id=sysco.id, unit_price=1.25),
            InventoryItem(property_id=main_camp.id, name="Black Beans", category="Canned/Jarred", unit="can", par_level=15, supplier_id=sysco.id, unit_price=1.00),
            InventoryItem(property_id=main_camp.id, name="Peanut Butter", category="Canned/Jarred", unit="jar", par_level=8, supplier_id=costco.id, unit_price=6.50),
            InventoryItem(property_id=main_camp.id, name="Ketchup", category="Canned/Jarred", unit="bottle", par_level=6, supplier_id=sysco.id, unit_price=3.50),
            # Beverages
            InventoryItem(property_id=main_camp.id, name="Coffee (Ground)", category="Beverages", unit="lb", par_level=10, supplier_id=sysco.id, unit_price=8.00),
            InventoryItem(property_id=main_camp.id, name="Orange Juice", category="Beverages", unit="gallon", par_level=6, supplier_id=sysco.id, unit_price=6.50),
            # Condiments
            InventoryItem(property_id=main_camp.id, name="Salt", category="Condiments", unit="container", par_level=5, supplier_id=sysco.id, unit_price=2.00),
            InventoryItem(property_id=main_camp.id, name="Vegetable Oil", category="Condiments", unit="gallon", par_level=3, supplier_id=sysco.id, unit_price=10.00),
            InventoryItem(property_id=main_camp.id, name="Ranch Dressing", category="Condiments", unit="bottle", par_level=6, supplier_id=sysco.id, unit_price=4.50),
        ]

        for i, item in enumerate(inventory_items):
            item.sort_order = i
            db.add(item)

        db.commit()

        print("\n=== SEED DATA COMPLETE ===")
        print(f"Created {len(properties)} properties")
        print(f"Created {len(users)} users")
        print(f"Created {len(suppliers)} suppliers")
        print(f"Created {len(inventory_items)} inventory items")
        print("\n=== LOGIN CREDENTIALS ===")
        print("Admin: admin@sukakpak.com / admin123")
        print("Supervisor: supervisor@sukakpak.com / super123")
        print("Purchasing: purchasing@sukakpak.com / purchase123")
        print("Main Camp Worker: maincamp@sukakpak.com / camp123")
        print("North Camp Worker: northcamp@sukakpak.com / camp123")

    except Exception as e:
        print(f"Error seeding data: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_data()
