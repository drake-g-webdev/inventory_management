import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.core.database import Base, get_db
from app.core.security import get_password_hash
from app.models.user import User, UserRole
from app.models.property import Property
from app.models.inventory import InventoryItem
from app.models.supplier import Supplier

# Create in-memory SQLite database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db_session():
    """Create a fresh database session for each test."""
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function", autouse=True)
def mock_emails():
    """Disable all email sending during tests to prevent real emails."""
    with patch('app.core.email.send_email', return_value=True), \
         patch('app.core.email.send_order_submitted_notification', return_value=None), \
         patch('app.core.email.send_order_approved_notification', return_value=None), \
         patch('app.core.email.send_order_changes_requested_notification', return_value=None), \
         patch('app.core.email.send_flagged_items_notification', return_value=None):
        yield


@pytest.fixture(scope="function")
def client(db_session):
    """Create a test client with database override."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def test_user(db_session):
    """Create a test user."""
    user = User(
        email="test@example.com",
        hashed_password=get_password_hash("testpassword"),
        full_name="Test User",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def auth_headers(client, test_user):
    """Get authentication headers for test user."""
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "test@example.com", "password": "testpassword"},
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ============== SHARED ENTITY FIXTURES ==============

@pytest.fixture(scope="function")
def test_property(db_session):
    """Create a test property."""
    prop = Property(
        name="Yukon River Camp",
        code="YRC",
        is_active=True,
    )
    db_session.add(prop)
    db_session.commit()
    db_session.refresh(prop)
    return prop


@pytest.fixture(scope="function")
def second_property(db_session):
    """Create a second test property for isolation tests."""
    prop = Property(
        name="Denali Base Camp",
        code="DBC",
        is_active=True,
    )
    db_session.add(prop)
    db_session.commit()
    db_session.refresh(prop)
    return prop


@pytest.fixture(scope="function")
def test_supplier(db_session):
    """Create a test supplier."""
    supplier = Supplier(
        name="Test Supplier",
        contact_name="John Contact",
        email="supplier@example.com",
        phone="555-1234",
    )
    db_session.add(supplier)
    db_session.commit()
    db_session.refresh(supplier)
    return supplier


@pytest.fixture(scope="function")
def test_inventory_item(db_session, test_property, test_supplier):
    """Create a test inventory item."""
    item = InventoryItem(
        name="Flour",
        category="Dry Goods",
        unit="lb",
        property_id=test_property.id,
        supplier_id=test_supplier.id,
        par_level=50.0,
        current_stock=25.0,
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    return item


# ============== SHARED ROLE FIXTURES ==============

@pytest.fixture(scope="function")
def camp_worker_user(db_session, test_property):
    """Create a camp worker user assigned to test property."""
    user = User(
        email="campworker@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Camp Worker",
        role=UserRole.CAMP_WORKER.value,
        property_id=test_property.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def supervisor_user(db_session, test_property):
    """Create a purchasing supervisor user."""
    user = User(
        email="supervisor@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Supervisor User",
        role=UserRole.PURCHASING_SUPERVISOR.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def purchasing_team_user(db_session):
    """Create a purchasing team user."""
    user = User(
        email="purchaser@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Purchaser User",
        role=UserRole.PURCHASING_TEAM.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture(scope="function")
def admin_user(db_session):
    """Create an admin user."""
    user = User(
        email="admin@example.com",
        hashed_password=get_password_hash("password123"),
        full_name="Admin User",
        role=UserRole.ADMIN.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def get_auth_headers(client, email, password="password123"):
    """Helper to get auth headers for a user."""
    response = client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="function")
def admin_headers(client, admin_user):
    """Convenience fixture for admin auth headers."""
    return get_auth_headers(client, admin_user.email)
