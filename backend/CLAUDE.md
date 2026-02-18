# Backend Guard Rails

## STOP - Before ANY commit touching backend files:
- Verify `main.py` has its .py extension: `ls backend/app/main.py`
- New columns on EXISTING tables need a block in `add_missing_columns()` in main.py
- New models MUST be imported in `models/__init__.py` or they won't be created
- Run `python -c "from app.main import app"` to verify imports work

## STOP - After pushing to Railway:
- If 502 persists despite clean deploy logs, run: `railway service lucky-clarity && railway redeploy --yes`
- CORS errors in browser = backend is down (502 has no CORS headers), NOT a CORS config issue
- Check `/health/db` endpoint to verify database connectivity

## Railway Details
- Project: zippy-respect
- Backend service: lucky-clarity (port 8080)
- Frontend service: inventory_management
- Config: backend/railway.toml
- SECRET_KEY env var is REQUIRED (no default) - app crashes without it

## Schema Migration Pattern (no Alembic on Railway)
New column on existing table → add to model + schema + add_missing_columns() in main.py
New table → add model + import in models/__init__.py (create_all handles it)
