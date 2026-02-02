from fastapi import APIRouter
from app.api.endpoints import auth, properties, users, suppliers, inventory, orders, receipts, admin, notifications, master_products

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(properties.router)
api_router.include_router(users.router)
api_router.include_router(suppliers.router)
api_router.include_router(inventory.router)
api_router.include_router(orders.router)
api_router.include_router(receipts.router)
api_router.include_router(admin.router)
api_router.include_router(notifications.router)
api_router.include_router(master_products.router)
