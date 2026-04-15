import os

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
import backend.db as db_module
from backend.services.rate_limit import reset_rate_limits


def _point_at_tmp(tmp_path) -> None:
    db_module.DATA_DIR    = tmp_path
    db_module.DB_PATH     = tmp_path / "script-database"
    db_module.SCRIPTS_DIR = tmp_path / "scripts"
    db_module.LOGS_DIR    = tmp_path / "logs"
    # Clear the process-global rate-limit buckets so tests don't bleed into
    # each other.
    reset_rate_limits()


# Credentials used by the bootstrap helper for tests. Deliberately weak — these
# never leave the test process.
TEST_ADMIN_USER     = "admin"
TEST_ADMIN_PASSWORD = "testpw"
TEST_MASTER         = "testmaster"


@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    """Unauthenticated HTTP client — still bootstraps an admin user + master pw
    under the hood so that ``/api/auth/login`` is available, but the client's
    cookie jar starts empty.
    """
    _point_at_tmp(tmp_path)
    monkeypatch.setenv("ADMIN_USERNAME",  TEST_ADMIN_USER)
    monkeypatch.setenv("ADMIN_PASSWORD",  TEST_ADMIN_PASSWORD)
    monkeypatch.setenv("MASTER_PASSWORD", TEST_MASTER)

    from backend.main import app
    await db_module.init_db()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def auth_client(tmp_path, monkeypatch):
    """HTTP client already logged in as the bootstrapped admin."""
    _point_at_tmp(tmp_path)
    monkeypatch.setenv("ADMIN_USERNAME",  TEST_ADMIN_USER)
    monkeypatch.setenv("ADMIN_PASSWORD",  TEST_ADMIN_PASSWORD)
    monkeypatch.setenv("MASTER_PASSWORD", TEST_MASTER)

    from backend.main import app
    await db_module.init_db()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post(
            "/api/auth/login",
            json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASSWORD},
        )
        assert res.status_code == 200, res.text
        yield ac
