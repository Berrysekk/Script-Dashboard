import pytest

from backend import db as _db
from backend.tests.conftest import _point_at_tmp


@pytest.fixture(autouse=True)
def _isolate_db(tmp_path, monkeypatch):
    _point_at_tmp(tmp_path)
    monkeypatch.setenv("ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ADMIN_PASSWORD", "testpw")
    monkeypatch.setenv("MASTER_PASSWORD", "testmaster")


@pytest.mark.asyncio
async def test_database_tables_exist():
    await _db.init_db()
    async with _db.get_db() as db:
        cur = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name IN ('databases', 'database_columns', 'database_rows', 'role_databases') "
            "ORDER BY name"
        )
        names = [r["name"] for r in await cur.fetchall()]
    assert names == ["database_columns", "database_rows", "databases", "role_databases"]


@pytest.mark.asyncio
async def test_database_cascade_delete():
    await _db.init_db()
    async with _db.get_db() as db:
        await db.execute(
            "INSERT INTO databases (id, name, slug) VALUES (?, ?, ?)",
            ("db1", "NVR List", "nvr_list"),
        )
        await db.execute(
            "INSERT INTO database_columns (id, database_id, name, key, type, position) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("c1", "db1", "IP", "ip", "text", 0),
        )
        await db.execute(
            "INSERT INTO database_rows (id, database_id, values_json, position) "
            "VALUES (?, ?, ?, ?)",
            ("r1", "db1", '{"ip": "10.0.0.1"}', 0),
        )
        await db.commit()
        await db.execute("DELETE FROM databases WHERE id = ?", ("db1",))
        await db.commit()
        cur = await db.execute("SELECT COUNT(*) AS n FROM database_columns")
        assert (await cur.fetchone())["n"] == 0
        cur = await db.execute("SELECT COUNT(*) AS n FROM database_rows")
        assert (await cur.fetchone())["n"] == 0
