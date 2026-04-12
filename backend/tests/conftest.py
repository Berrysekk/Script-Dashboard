import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
import backend.db as db_module


@pytest_asyncio.fixture
async def client(tmp_path):
    db_module.DATA_DIR    = tmp_path
    db_module.DB_PATH     = tmp_path / "script-database"
    db_module.SCRIPTS_DIR = tmp_path / "scripts"
    db_module.LOGS_DIR    = tmp_path / "logs"

    from backend.main import app
    await db_module.init_db()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
