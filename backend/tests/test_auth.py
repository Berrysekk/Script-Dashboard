import io

import pytest
from httpx import AsyncClient, ASGITransport

from backend.tests.conftest import TEST_ADMIN_PASSWORD, TEST_ADMIN_USER, TEST_MASTER


# ── Login / logout / me ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_success(client):
    res = await client.post(
        "/api/auth/login",
        json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASSWORD},
    )
    assert res.status_code == 200
    assert res.json()["role"] == "admin"
    assert "sd_session" in res.cookies


@pytest.mark.asyncio
async def test_login_bad_password(client):
    res = await client.post(
        "/api/auth/login",
        json={"username": TEST_ADMIN_USER, "password": "wrong"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user(client):
    res = await client.post(
        "/api/auth/login",
        json={"username": "nobody", "password": "x"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_without_cookie(client):
    res = await client.get("/api/scripts")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_admin(auth_client):
    res = await auth_client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["role"] == "admin"
    assert res.json()["username"] == TEST_ADMIN_USER


@pytest.mark.asyncio
async def test_logout_invalidates_session(auth_client):
    res = await auth_client.post("/api/auth/logout")
    assert res.status_code == 200
    # Cookie is cleared; /me should now reject.
    res = await auth_client.get("/api/auth/me")
    assert res.status_code == 401


# ── Admin user management ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_can_create_and_delete_user(auth_client):
    res = await auth_client.post(
        "/api/auth/users",
        json={"username": "alice", "password": "alicepw", "role": "user"},
    )
    assert res.status_code == 200
    user_id = res.json()["id"]

    res = await auth_client.get("/api/auth/users")
    assert res.status_code == 200
    assert any(u["username"] == "alice" for u in res.json())

    res = await auth_client.delete(f"/api/auth/users/{user_id}")
    assert res.status_code == 200

    res = await auth_client.get("/api/auth/users")
    assert not any(u["username"] == "alice" for u in res.json())


@pytest.mark.asyncio
async def test_admin_cannot_delete_self(auth_client):
    me = (await auth_client.get("/api/auth/me")).json()
    res = await auth_client.delete(f"/api/auth/users/{me['id']}")
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_non_admin_cannot_list_users(auth_client):
    # Create a regular user, log in as them, hit /api/auth/users → 403.
    await auth_client.post(
        "/api/auth/users",
        json={"username": "bob", "password": "bobpw", "role": "user"},
    )
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as bob:
        res = await bob.post(
            "/api/auth/login",
            json={"username": "bob", "password": "bobpw"},
        )
        assert res.status_code == 200
        res = await bob.get("/api/auth/users")
        assert res.status_code == 403


# ── Owner isolation on scripts ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_non_admin_cannot_see_others_scripts(auth_client):
    # Admin uploads a script.
    up = await auth_client.post(
        "/api/scripts",
        files={"file": ("x.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "Admin's script"},
    )
    assert up.status_code == 200
    sid = up.json()["id"]

    # Create and log in as a regular user.
    await auth_client.post(
        "/api/auth/users",
        json={"username": "carol", "password": "carolpw", "role": "user"},
    )
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as carol:
        res = await carol.post(
            "/api/auth/login",
            json={"username": "carol", "password": "carolpw"},
        )
        assert res.status_code == 200

        # Carol's script list should be empty.
        res = await carol.get("/api/scripts")
        assert res.json() == []

        # Direct-fetching the admin's script should 404 (not 403 — we
        # deliberately don't leak existence).
        res = await carol.get(f"/api/scripts/{sid}")
        assert res.status_code == 404


# ── Master password recovery ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reset_password_with_master(client):
    res = await client.post(
        "/api/auth/reset-password",
        json={
            "username": TEST_ADMIN_USER,
            "master_password": TEST_MASTER,
            "new_password": "fresh-pw",
        },
    )
    assert res.status_code == 200

    # New password works.
    res = await client.post(
        "/api/auth/login",
        json={"username": TEST_ADMIN_USER, "password": "fresh-pw"},
    )
    assert res.status_code == 200

    # Old password no longer works.
    from backend.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as other:
        res = await other.post(
            "/api/auth/login",
            json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASSWORD},
        )
        assert res.status_code == 401


@pytest.mark.asyncio
async def test_reset_password_wrong_master(client):
    res = await client.post(
        "/api/auth/reset-password",
        json={
            "username": TEST_ADMIN_USER,
            "master_password": "definitely-not-it",
            "new_password": "fresh-pw",
        },
    )
    assert res.status_code == 401

    # Old password should still work.
    res = await client.post(
        "/api/auth/login",
        json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASSWORD},
    )
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_invalidates_sessions(auth_client):
    # Already logged in as admin via auth_client fixture. Reset via master.
    res = await auth_client.post(
        "/api/auth/reset-password",
        json={
            "username": TEST_ADMIN_USER,
            "master_password": TEST_MASTER,
            "new_password": "another-one",
        },
    )
    assert res.status_code == 200
    # Existing session should now be invalid.
    res = await auth_client.get("/api/auth/me")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_no_http_route_writes_master(client):
    """Guard against anyone ever adding an endpoint that rotates the master pw."""
    for path in ("/api/auth/master-password", "/api/auth/master", "/api/master-password"):
        res = await client.post(path, json={"new_password": "hacked"})
        assert res.status_code in (404, 405), f"{path} unexpectedly exists"


# ── Bootstrap sanity ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_bootstrap_creates_admin_and_master(client):
    # Login with the env-var password proves bootstrap_admin ran.
    res = await client.post(
        "/api/auth/login",
        json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASSWORD},
    )
    assert res.status_code == 200
    # And reset-password with the env-var master proves bootstrap_master_password ran.
    res = await client.post(
        "/api/auth/reset-password",
        json={
            "username": TEST_ADMIN_USER,
            "master_password": TEST_MASTER,
            "new_password": TEST_ADMIN_PASSWORD,  # reset to same
        },
    )
    assert res.status_code == 200
