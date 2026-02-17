from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
import os
import logging
import traceback

from app.core.config import settings
from app.core.database import engine, Base
from app.api.router import api_router

# Create database tables
Base.metadata.create_all(bind=engine)

# Add missing columns to existing tables (for deployments without migrations)
def add_missing_columns():
    """Add new columns to existing tables if they don't exist"""
    with engine.connect() as conn:
        # Check and add product_notes column to inventory_items
        try:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'inventory_items' AND column_name = 'product_notes'
            """))
            if not result.fetchone():
                conn.execute(text("ALTER TABLE inventory_items ADD COLUMN product_notes TEXT"))
                conn.commit()
                print("Added product_notes column to inventory_items table")
        except Exception as e:
            print(f"Note: Could not check/add product_notes column: {e}")

        # Check and add master_product_id column to inventory_items
        try:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'inventory_items' AND column_name = 'master_product_id'
            """))
            if not result.fetchone():
                conn.execute(text("ALTER TABLE inventory_items ADD COLUMN master_product_id INTEGER REFERENCES master_products(id)"))
                conn.commit()
                print("Added master_product_id column to inventory_items table")
        except Exception as e:
            print(f"Note: Could not check/add master_product_id column: {e}")

        # Check and add seasonal_availability column to master_products
        try:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'master_products' AND column_name = 'seasonal_availability'
            """))
            if not result.fetchone():
                conn.execute(text("ALTER TABLE master_products ADD COLUMN seasonal_availability VARCHAR(50) DEFAULT 'year_round'"))
                conn.commit()
                print("Added seasonal_availability column to master_products table")
        except Exception as e:
            print(f"Note: Could not check/add seasonal_availability column: {e}")

        # Check and add qty column to master_products
        try:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'master_products' AND column_name = 'qty'
            """))
            if not result.fetchone():
                conn.execute(text("ALTER TABLE master_products ADD COLUMN qty VARCHAR(50)"))
                conn.commit()
                print("Added qty column to master_products table")
        except Exception as e:
            print(f"Note: Could not check/add qty column to master_products: {e}")

        # Check and add qty column to inventory_items
        try:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'inventory_items' AND column_name = 'qty'
            """))
            if not result.fetchone():
                conn.execute(text("ALTER TABLE inventory_items ADD COLUMN qty VARCHAR(50)"))
                conn.commit()
                print("Added qty column to inventory_items table")
        except Exception as e:
            print(f"Note: Could not check/add qty column to inventory_items: {e}")

        # Check and add seasonal_availability column to inventory_items
        try:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'inventory_items' AND column_name = 'seasonal_availability'
            """))
            if not result.fetchone():
                conn.execute(text("ALTER TABLE inventory_items ADD COLUMN seasonal_availability VARCHAR(50) DEFAULT 'year_round'"))
                conn.commit()
                print("Added seasonal_availability column to inventory_items table")
        except Exception as e:
            print(f"Note: Could not check/add seasonal_availability column to inventory_items: {e}")

        # Check and add default_order_at column to master_products
        try:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'master_products' AND column_name = 'default_order_at'
            """))
            if not result.fetchone():
                conn.execute(text("ALTER TABLE master_products ADD COLUMN default_order_at FLOAT"))
                conn.commit()
                print("Added default_order_at column to master_products table")
        except Exception as e:
            print(f"Note: Could not check/add default_order_at column: {e}")

        # Check and add order_at column to inventory_items
        try:
            result = conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'inventory_items' AND column_name = 'order_at'
            """))
            if not result.fetchone():
                conn.execute(text("ALTER TABLE inventory_items ADD COLUMN order_at FLOAT"))
                conn.commit()
                print("Added order_at column to inventory_items table")
        except Exception as e:
            print(f"Note: Could not check/add order_at column: {e}")

try:
    add_missing_columns()
except Exception as e:
    print(f"Warning: Could not run column migrations: {e}")

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

# Create FastAPI app
app = FastAPI(
    title="SUKAKPAK Purchasing Management API",
    description="API for managing inventory, suppliers, and purchase orders",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# Add rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware - allow Railway domains and localhost
allowed_origins = [
    "http://localhost:3001",
    "http://localhost:3005",
    "https://inventorymanagement-production-8ea8.up.railway.app",
]
# Add FRONTEND_URL from settings if it exists and isn't already in the list
if settings.FRONTEND_URL and settings.FRONTEND_URL not in allowed_origins:
    allowed_origins.append(settings.FRONTEND_URL)

# Filter out any None or empty values
allowed_origins = [origin for origin in allowed_origins if origin]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global exception handler to ensure errors always return proper JSON responses
# (prevents CORS errors when unhandled exceptions occur)
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logging.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}")
    logging.error(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    )

# Include API routes
app.include_router(api_router)

# Mount static files for uploads
uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


@app.get("/")
def root():
    return {"message": "SUKAKPAK Purchasing Management API", "version": "1.0.0"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
