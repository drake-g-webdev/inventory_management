# CLAUDE.md - AI Agent Reference for SUKAKPAK Purchasing Management

> This file is read by Claude at the start of every session. It exists to prevent
> repeated mistakes and provide instant context about this codebase.

---

## CRITICAL WARNINGS (READ FIRST)

### 1. NEVER rename or move `backend/app/main.py`
The file `backend/app/main.py` is the FastAPI entrypoint referenced by:
- `backend/Dockerfile` CMD: `uvicorn app.main:app`
- Every import chain in the backend
- Railway's deployment process

**Incident (Feb 2025):** A git staging issue silently renamed `main.py` to `main`
(no extension), breaking the entire production deployment. The fix required both
restoring the filename AND running `railway redeploy` via CLI because Railway's
proxy routing got stuck.

**Prevention:** After any commit touching backend files, verify with:
```bash
ls backend/app/main.py  # must exist with .py extension
```

### 2. Railway deploys via git push can leave stale proxy routing
When Railway builds succeed but the app returns 502 with `x-railway-fallback: true`,
the container is running but Railway's proxy can't reach it. Git pushes and empty
commits will NOT fix this. The fix is:
```bash
railway service lucky-clarity && railway redeploy --yes
```
This forces a full teardown of both container AND routing layer.

### 3. `SECRET_KEY` has no default - app crashes without it
`backend/app/core/config.py` declares `SECRET_KEY: str` with no default.
If this env var is missing on Railway, the app fails at import time with a
Pydantic ValidationError. Never remove it from Railway's env vars.

### 4. `Base.metadata.create_all()` runs at module import time
Line 29 of `main.py` creates all database tables on every startup. This means:
- New SQLAlchemy models are auto-created on deploy (no migration needed for new tables)
- But new COLUMNS on existing tables need `add_missing_columns()` in main.py
- The `add_missing_columns()` function must be updated when adding columns to existing models

### 5. Don't add Alembic migrations for Railway deploys
Railway doesn't run `alembic upgrade head`. All schema changes for existing tables
go through the `add_missing_columns()` function in `main.py`. Alembic files exist
but are for local dev reference only.

---

## RAILWAY DEPLOYMENT ARCHITECTURE

### Three Services (Project: zippy-respect)

| Service | Name | Domain | Root Dir | Port |
|---------|------|--------|----------|------|
| Backend | `lucky-clarity` | `lucky-clarity-production.up.railway.app` | `/backend` | 8080 (Railway sets PORT) |
| Frontend | `inventory_management` | `inventorymanagement-production-8ea8.up.railway.app` | `/frontend` | 8080 |
| Database | `Postgres` | Internal only | N/A | 5432 |

### Railway CLI Commands (must be linked first)
```bash
railway link -p zippy-respect -e production
railway service lucky-clarity        # link to backend
railway service inventory_management # link to frontend
railway service Postgres             # link to database
railway logs                         # view runtime logs
railway redeploy --yes               # force full redeploy
railway variables                    # view env vars
```

### Config Files
- `backend/railway.toml` - Backend deploy config (healthcheck, restart policy)
- `frontend/railway.toml` - Frontend deploy config
- Dockerfile CMD uses `${PORT:-8000}` - Railway auto-sets PORT=8080

### Health Check
- Deploy health check: `GET /health` (simple JSON, no DB)
- Diagnostic endpoint: `GET /health/db` (tests DB connectivity)
- Health check timeout: 100 seconds

### Debugging 502 Errors
1. Check `railway logs` - if logs show successful startup but 502 persists, it's a routing issue
2. If container is crashing, logs will show Python tracebacks
3. `x-railway-fallback: true` header = Railway proxy issue, not app issue
4. CORS errors in browser are a SYMPTOM of 502, not the cause (502 response lacks CORS headers)

---

## CODEBASE STRUCTURE

### Backend (FastAPI + SQLAlchemy + PostgreSQL)
```
backend/
  app/
    main.py              # App entry point, startup, CORS, migrations
    core/
      config.py          # Pydantic Settings (env vars)
      database.py        # SQLAlchemy engine, session, Base
      security.py        # JWT auth, password hashing, role guards
      email.py           # SMTP email notifications
    api/
      router.py          # Main router - all endpoints mounted here
      endpoints/
        auth.py          # Login, register, profile
        orders.py        # Order CRUD + workflow (largest endpoint file)
        inventory.py     # Inventory items + counting
        master_products.py  # Master catalog + custom categories
        suppliers.py     # Supplier management
        properties.py    # Property/camp management
        receipts.py      # Receipt upload + AI OCR
        notifications.py # Notification system
        users.py         # User management
        admin.py         # Admin-only operations
    models/
      __init__.py        # ALL models imported here (important for create_all)
      user.py            # User, UserRole enum
      property.py        # Property
      supplier.py        # Supplier
      master_product.py  # MasterProduct, ProductCategory
      inventory.py       # InventoryItem, InventoryCount, InventoryCountItem, ReceiptCodeAlias
      order.py           # Order, OrderItem, OrderStatus enum, OrderItemFlag enum
      receipt.py         # Receipt
      notification.py    # Notification, NotificationType enum
    schemas/             # Pydantic request/response models (mirrors models/)
    utils/
  alembic/               # Migration files (reference only, not used on Railway)
  requirements.txt       # Python deps
  Dockerfile
  railway.toml
```

### Frontend (Next.js 14 + React Query + Zustand + Tailwind)
```
frontend/
  src/
    app/                 # Next.js App Router pages
      auth/login/        # Login page
      dashboard/         # Main dashboard
      inventory/         # Inventory management (view, count)
      orders/            # Order workflow (new, edit, review, receive, purchase-list, flagged)
      admin/             # Admin pages (users, properties, master-products, trends)
      suppliers/         # Supplier management
      receipts/          # Receipt management
    components/
      auth/              # AuthProvider, AuthGuard, RoleGuard
      layout/            # DashboardLayout, Sidebar
      notifications/     # NotificationBell
      ui/                # Button, Input, Modal, Badge, Table, Select, ErrorBoundary
    hooks/               # React Query hooks (one per resource)
      useOrders.ts, useInventory.ts, useMasterProducts.ts, useSuppliers.ts,
      useProperties.ts, useUsers.ts, useReceipts.ts, useNotifications.ts,
      usePurchaseOrders.ts, useCategories.ts, useItems.ts, useItemTrends.ts
    stores/
      authStore.ts       # Zustand auth state + role helpers
    lib/
      api.ts             # Axios instance with JWT interceptor
      constants.ts       # UNITS, CATEGORIES, SUBCATEGORY_DEFAULT_UNITS
      utils.ts           # Utility functions
    types/
      index.ts           # All TypeScript interfaces
  package.json
  Dockerfile
  railway.toml
```

---

## DATABASE RELATIONSHIPS (Key Foreign Keys)

```
User.property_id → Property.id
InventoryItem.property_id → Property.id
InventoryItem.supplier_id → Supplier.id
InventoryItem.master_product_id → MasterProduct.id
MasterProduct.supplier_id → Supplier.id
Order.property_id → Property.id
Order.created_by → User.id
Order.reviewed_by → User.id
OrderItem.order_id → Order.id
OrderItem.inventory_item_id → InventoryItem.id
OrderItem.supplier_id → Supplier.id
InventoryCount.property_id → Property.id
InventoryCountItem.inventory_count_id → InventoryCount.id
InventoryCountItem.inventory_item_id → InventoryItem.id
Receipt.order_id → Order.id
Receipt.supplier_id → Supplier.id
Notification.user_id → User.id
Notification.order_id → Order.id
ReceiptCodeAlias.inventory_item_id → InventoryItem.id
ReceiptCodeAlias.supplier_id → Supplier.id
```

---

## USER ROLES & PERMISSIONS

| Role | Can Create Orders | Can Review Orders | Can Manage Receipts | Can Manage Users | Property Scoped |
|------|-------------------|-------------------|---------------------|------------------|-----------------|
| admin | Yes | Yes | Yes | Yes | No (sees all) |
| camp_worker | Yes (own property) | No | No | No | Yes |
| purchasing_supervisor | No | Yes | Yes | No | No (sees all) |
| purchasing_team | No | No | Yes | No | No (sees all) |

---

## ORDER STATUS WORKFLOW

```
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → ORDERED → PARTIALLY_RECEIVED → RECEIVED
                                  ↘ CHANGES_REQUESTED → (back to DRAFT)
                   ↘ CANCELLED
```

---

## PATTERNS TO FOLLOW

### Adding a new column to an EXISTING table
1. Add the column to the SQLAlchemy model in `backend/app/models/`
2. Add the column to the Pydantic schema in `backend/app/schemas/`
3. Add a migration block to `add_missing_columns()` in `backend/app/main.py`:
```python
try:
    result = conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'TABLE_NAME' AND column_name = 'COLUMN_NAME'
    """))
    if not result.fetchone():
        conn.execute(text("ALTER TABLE TABLE_NAME ADD COLUMN COLUMN_NAME TYPE"))
        conn.commit()
        print("Added COLUMN_NAME column to TABLE_NAME table")
except Exception as e:
    print(f"Note: Could not check/add COLUMN_NAME column: {e}")
```
4. Update TypeScript types in `frontend/src/types/index.ts`

### Adding a new TABLE
1. Create the model in `backend/app/models/` (or add to existing file)
2. Import it in `backend/app/models/__init__.py` (REQUIRED for create_all to find it)
3. `Base.metadata.create_all()` handles the rest on deploy

### Adding a new API endpoint
1. Add the endpoint function to the appropriate file in `backend/app/api/endpoints/`
2. If new file, register it in `backend/app/api/router.py`
3. Add corresponding React Query hook in `frontend/src/hooks/`
4. Add TypeScript types in `frontend/src/types/index.ts`

### Adding a frontend page
1. Create `page.tsx` in `frontend/src/app/<route>/`
2. Wrap with `AuthGuard` (and `RoleGuard` if admin-only)
3. Use `DashboardLayout` for consistent navigation
4. Add navigation link in `frontend/src/components/layout/Sidebar.tsx`

### Categories system
- Hardcoded categories: `frontend/src/lib/constants.ts` (CATEGORIES, UNITS, SUBCATEGORY_DEFAULT_UNITS)
- Custom categories: stored in `product_categories` table, managed via `/master-products/categories/custom`
- Frontend merges both: `useCustomCategories()` hook + `CATEGORIES` constant
- Both master-products page and inventory page must merge custom + hardcoded

---

## CORS CONFIGURATION

Allowed origins are set in `backend/app/main.py`:
- `http://localhost:3001` (local dev)
- `http://localhost:3005` (alt local)
- `https://inventorymanagement-production-8ea8.up.railway.app` (production)
- `settings.FRONTEND_URL` (from env)

If the frontend domain changes on Railway, update BOTH:
1. The hardcoded list in `main.py`
2. The `FRONTEND_URL` env var on Railway

---

## COMMON GOTCHAS

1. **TypeScript check:** Always run `cd frontend && npx tsc --noEmit` before pushing
2. **Model imports:** New models MUST be imported in `backend/app/models/__init__.py` or create_all won't see them
3. **React Query invalidation:** Mutations should invalidate related queries (check existing hooks for patterns)
4. **Property scoping:** Camp workers can only see their assigned property's data - always check property_id filtering
5. **Soft deletes:** Most entities use `is_active` flag, not hard deletes. Filter by `is_active=True` in queries
6. **Eager loading:** Use `selectinload()` / `joinedload()` to avoid N+1 queries (check existing endpoint patterns)
7. **File uploads:** Images go to `backend/uploads/` directory, served via `/uploads/` static mount
8. **Date handling:** Backend uses `DateTime(timezone=True)`, frontend should handle UTC conversion
9. **Constants sync:** UNITS and CATEGORIES are defined in frontend `constants.ts` - backend doesn't validate against these
10. **Pool settings:** DB connection pool: size=5, max_overflow=10, recycle=300s, pre_ping=True (database.py)
