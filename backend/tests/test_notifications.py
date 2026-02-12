import pytest
from fastapi.testclient import TestClient

from app.models.notification import Notification
from app.models.user import User, UserRole
from app.core.security import get_password_hash

from tests.conftest import get_auth_headers


API_PREFIX = "/api/v1/notifications"


# ============== HELPERS ==============

def _create_notification(db_session, user_id, title="Test Notification", message="Test message",
                         notification_type="order_update", is_read=False):
    """Helper to insert a notification directly via the database session."""
    notif = Notification(
        user_id=user_id,
        title=title,
        message=message,
        type=notification_type,
        is_read=is_read,
    )
    db_session.add(notif)
    db_session.commit()
    db_session.refresh(notif)
    return notif


# ============== GET NOTIFICATIONS TESTS ==============

def test_get_notifications_empty_for_new_user(client: TestClient, db_session, camp_worker_user):
    """New user with no notifications should receive an empty list and unread_count of 0."""
    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.get(API_PREFIX, headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["notifications"] == []
    assert data["unread_count"] == 0


def test_get_notifications_returns_own_only(client: TestClient, db_session, camp_worker_user, supervisor_user):
    """Each user should only see notifications addressed to them."""
    # Create notifications for each user
    _create_notification(db_session, camp_worker_user.id, title="Worker Notif 1")
    _create_notification(db_session, camp_worker_user.id, title="Worker Notif 2")
    _create_notification(db_session, supervisor_user.id, title="Supervisor Notif 1")

    # Camp worker should see exactly 2 notifications
    worker_headers = get_auth_headers(client, camp_worker_user.email)
    worker_response = client.get(API_PREFIX, headers=worker_headers)
    assert worker_response.status_code == 200
    worker_data = worker_response.json()
    assert len(worker_data["notifications"]) == 2
    worker_titles = {n["title"] for n in worker_data["notifications"]}
    assert worker_titles == {"Worker Notif 1", "Worker Notif 2"}

    # Supervisor should see exactly 1 notification
    supervisor_headers = get_auth_headers(client, supervisor_user.email)
    supervisor_response = client.get(API_PREFIX, headers=supervisor_headers)
    assert supervisor_response.status_code == 200
    supervisor_data = supervisor_response.json()
    assert len(supervisor_data["notifications"]) == 1
    assert supervisor_data["notifications"][0]["title"] == "Supervisor Notif 1"


def test_get_notifications_includes_unread_count(client: TestClient, db_session, camp_worker_user):
    """The unread_count field should reflect the number of unread notifications."""
    _create_notification(db_session, camp_worker_user.id, title="Unread 1", is_read=False)
    _create_notification(db_session, camp_worker_user.id, title="Unread 2", is_read=False)
    _create_notification(db_session, camp_worker_user.id, title="Read 1", is_read=True)

    headers = get_auth_headers(client, camp_worker_user.email)
    response = client.get(API_PREFIX, headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data["notifications"]) == 3
    assert data["unread_count"] == 2


def test_get_notifications_unread_only_filter(client: TestClient, db_session, camp_worker_user):
    """When unread_only=true, only unread notifications should be returned."""
    _create_notification(db_session, camp_worker_user.id, title="Unread", is_read=False)
    _create_notification(db_session, camp_worker_user.id, title="Read", is_read=True)

    headers = get_auth_headers(client, camp_worker_user.email)
    response = client.get(f"{API_PREFIX}?unread_only=true", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data["notifications"]) == 1
    assert data["notifications"][0]["title"] == "Unread"
    # unread_count should still reflect all unread (same value since only 1 unread)
    assert data["unread_count"] == 1


# ============== UNREAD COUNT ENDPOINT ==============

def test_get_unread_count(client: TestClient, db_session, camp_worker_user):
    """The /unread-count endpoint should return the correct count of unread notifications."""
    _create_notification(db_session, camp_worker_user.id, is_read=False)
    _create_notification(db_session, camp_worker_user.id, is_read=False)
    _create_notification(db_session, camp_worker_user.id, is_read=True)

    headers = get_auth_headers(client, camp_worker_user.email)
    response = client.get(f"{API_PREFIX}/unread-count", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["unread_count"] == 2


# ============== MARK READ TESTS ==============

def test_mark_specific_notifications_as_read(client: TestClient, db_session, camp_worker_user):
    """POST /mark-read should mark the specified notifications as read."""
    notif1 = _create_notification(db_session, camp_worker_user.id, title="Notif 1", is_read=False)
    notif2 = _create_notification(db_session, camp_worker_user.id, title="Notif 2", is_read=False)
    notif3 = _create_notification(db_session, camp_worker_user.id, title="Notif 3", is_read=False)

    headers = get_auth_headers(client, camp_worker_user.email)

    # Mark only the first two as read
    response = client.post(
        f"{API_PREFIX}/mark-read",
        headers=headers,
        json={"notification_ids": [notif1.id, notif2.id]},
    )

    assert response.status_code == 200
    assert response.json()["success"] is True

    # Verify via the list endpoint: only 1 unread remaining
    list_response = client.get(API_PREFIX, headers=headers)
    list_data = list_response.json()
    assert list_data["unread_count"] == 1

    unread_titles = [n["title"] for n in list_data["notifications"] if not n["is_read"]]
    assert unread_titles == ["Notif 3"]


def test_mark_read_ignores_other_users_notifications(client: TestClient, db_session, camp_worker_user, supervisor_user):
    """Attempting to mark another user's notification as read should have no effect on it."""
    worker_notif = _create_notification(db_session, camp_worker_user.id, title="Worker Notif", is_read=False)
    supervisor_notif = _create_notification(db_session, supervisor_user.id, title="Supervisor Notif", is_read=False)

    # Supervisor tries to mark the worker's notification as read
    supervisor_headers = get_auth_headers(client, supervisor_user.email)
    response = client.post(
        f"{API_PREFIX}/mark-read",
        headers=supervisor_headers,
        json={"notification_ids": [worker_notif.id]},
    )
    assert response.status_code == 200

    # Worker's notification should still be unread
    worker_headers = get_auth_headers(client, camp_worker_user.email)
    worker_response = client.get(f"{API_PREFIX}/unread-count", headers=worker_headers)
    assert worker_response.json()["unread_count"] == 1


def test_mark_all_read(client: TestClient, db_session, camp_worker_user):
    """POST /mark-all-read should mark all of the current user's notifications as read."""
    _create_notification(db_session, camp_worker_user.id, is_read=False)
    _create_notification(db_session, camp_worker_user.id, is_read=False)
    _create_notification(db_session, camp_worker_user.id, is_read=False)

    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.post(f"{API_PREFIX}/mark-all-read", headers=headers)
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["marked_count"] == 3

    # Verify all are now read
    count_response = client.get(f"{API_PREFIX}/unread-count", headers=headers)
    assert count_response.json()["unread_count"] == 0


# ============== DELETE TESTS ==============

def test_delete_own_notification(client: TestClient, db_session, camp_worker_user):
    """Users should be able to delete their own notifications."""
    notif = _create_notification(db_session, camp_worker_user.id, title="To Delete")

    headers = get_auth_headers(client, camp_worker_user.email)

    response = client.delete(f"{API_PREFIX}/{notif.id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["success"] is True

    # Verify it is gone
    list_response = client.get(API_PREFIX, headers=headers)
    assert len(list_response.json()["notifications"]) == 0


def test_delete_other_users_notification_fails(client: TestClient, db_session, camp_worker_user, supervisor_user):
    """Deleting another user's notification should return 404."""
    supervisor_notif = _create_notification(db_session, supervisor_user.id, title="Supervisor Only")

    worker_headers = get_auth_headers(client, camp_worker_user.email)

    response = client.delete(f"{API_PREFIX}/{supervisor_notif.id}", headers=worker_headers)
    assert response.status_code == 404

    # Verify the notification still exists for the supervisor
    supervisor_headers = get_auth_headers(client, supervisor_user.email)
    supervisor_response = client.get(API_PREFIX, headers=supervisor_headers)
    assert len(supervisor_response.json()["notifications"]) == 1


# ============== AUTHENTICATION TESTS ==============

def test_unauthenticated_access_fails(client: TestClient, db_session):
    """All notification endpoints should reject unauthenticated requests with 401."""
    # GET notifications list
    assert client.get(API_PREFIX).status_code == 401

    # GET unread count
    assert client.get(f"{API_PREFIX}/unread-count").status_code == 401

    # POST mark-read
    assert client.post(f"{API_PREFIX}/mark-read", json={"notification_ids": [1]}).status_code == 401

    # POST mark-all-read
    assert client.post(f"{API_PREFIX}/mark-all-read").status_code == 401

    # DELETE notification
    assert client.delete(f"{API_PREFIX}/999").status_code == 401
