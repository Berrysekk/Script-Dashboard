import pytest
import aiosqlite
from pathlib import Path
from backend.db import init_db, get_db

@pytest.mark.asyncio
async def test_init_creates_tables(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await init_db()
    async with aiosqlite.connect(tmp_path / "script-database") as db:
        cur = await db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in await cur.fetchall()}
    assert "scripts" in tables
    assert "runs" in tables
