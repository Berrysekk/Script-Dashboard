import pytest

from backend import db as _db
from backend.services import databases as dbs


@pytest.mark.asyncio
async def test_database_tables_exist(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
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
async def test_database_cascade_delete(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
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
        await db.execute("INSERT INTO roles (name) VALUES (?)", ("testrole",))
        await db.execute(
            "INSERT INTO role_databases (role_name, database_id) VALUES (?, ?)",
            ("testrole", "db1"),
        )
        await db.commit()
        await db.execute("DELETE FROM databases WHERE id = ?", ("db1",))
        await db.commit()
        cur = await db.execute("SELECT COUNT(*) AS n FROM database_columns")
        assert (await cur.fetchone())["n"] == 0
        cur = await db.execute("SELECT COUNT(*) AS n FROM database_rows")
        assert (await cur.fetchone())["n"] == 0
        cur = await db.execute("SELECT COUNT(*) AS n FROM role_databases")
        assert (await cur.fetchone())["n"] == 0


def test_validate_slug_accepts_valid():
    assert dbs.validate_slug("nvr_list") == "nvr_list"
    assert dbs.validate_slug("a") == "a"
    assert dbs.validate_slug("_private") == "_private"
    assert dbs.validate_slug("abc123_xyz") == "abc123_xyz"


def test_validate_slug_rejects_invalid():
    for bad in ["", "1abc", "ABC", "foo-bar", "foo.bar", "../etc", "a" * 65]:
        with pytest.raises(ValueError):
            dbs.validate_slug(bad)


def test_derive_slug_from_name():
    assert dbs.derive_slug("NVR List") == "nvr_list"
    assert dbs.derive_slug("My Cameras!") == "my_cameras"
    assert dbs.derive_slug("  Leading spaces  ") == "leading_spaces"
    assert dbs.derive_slug("123abc") == "_123abc"


def test_validate_key_matches_slug_rules():
    assert dbs.validate_key("port") == "port"
    with pytest.raises(ValueError):
        dbs.validate_key("Port")
