from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,       # Wait max 30s for a connection from pool
    pool_recycle=300,       # Recycle connections after 5 minutes
    pool_pre_ping=True,     # Verify connections before use
)

# Set a statement timeout of 30s to kill long-running queries (PostgreSQL only)
if "postgresql" in settings.DATABASE_URL:
    @event.listens_for(engine, "connect")
    def set_statement_timeout(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("SET statement_timeout = '30s'")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
