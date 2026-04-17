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


def test_coerce_cell_text():
    assert dbs.coerce_cell("text", "hello", None) == "hello"
    assert dbs.coerce_cell("text", 42, None) == "42"
    assert dbs.coerce_cell("text", None, None) is None


def test_coerce_cell_number():
    assert dbs.coerce_cell("number", 7, None) == 7
    assert dbs.coerce_cell("number", "3.14", None) == 3.14
    assert dbs.coerce_cell("number", "", None) is None
    with pytest.raises(ValueError):
        dbs.coerce_cell("number", "not a number", None)


def test_coerce_cell_boolean():
    assert dbs.coerce_cell("boolean", True, None) is True
    assert dbs.coerce_cell("boolean", "true", None) is True
    assert dbs.coerce_cell("boolean", "false", None) is False
    assert dbs.coerce_cell("boolean", 0, None) is False
    with pytest.raises(ValueError):
        dbs.coerce_cell("boolean", "maybe", None)


def test_coerce_cell_select_enforces_options():
    cfg = {"options": ["http", "https"]}
    assert dbs.coerce_cell("select", "http", cfg) == "http"
    with pytest.raises(ValueError):
        dbs.coerce_cell("select", "ftp", cfg)


def test_coerce_cell_json_parses_strings():
    assert dbs.coerce_cell("json", '{"a": 1}', None) == {"a": 1}
    assert dbs.coerce_cell("json", [1, 2, 3], None) == [1, 2, 3]
    with pytest.raises(ValueError):
        dbs.coerce_cell("json", "not json", None)


def test_coerce_cell_date():
    assert dbs.coerce_cell("date", "2026-04-17", None) == "2026-04-17"
    with pytest.raises(ValueError):
        dbs.coerce_cell("date", "not-a-date", None)


@pytest.mark.asyncio
async def test_create_database_auto_slug(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        db_id = await dbs.create_database(db, name="NVR List", slug=None, description=None)
        cur = await db.execute("SELECT slug FROM databases WHERE id = ?", (db_id,))
        row = await cur.fetchone()
    assert row["slug"] == "nvr_list"


@pytest.mark.asyncio
async def test_create_database_slug_conflict_raises(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        await dbs.create_database(db, "First", "taken", None)
        with pytest.raises(dbs.SlugConflict) as ei:
            await dbs.create_database(db, "Second", "taken", None)
        assert ei.value.suggestion == "taken_2"


@pytest.mark.asyncio
async def test_list_databases_includes_counts(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "NVR", "nvr", None)
        await dbs.create_column(db, did, "IP", "ip", "text", None)
        await dbs.create_row(db, did, {"ip": "1.1.1.1"})
        listing = await dbs.list_databases(db)
    assert listing[0]["row_count"] == 1
    assert listing[0]["column_count"] == 1


@pytest.mark.asyncio
async def test_update_database_rename_slug(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "Old", "old_slug", None)
        await dbs.update_database(db, did, name="New", slug="new_slug", description="d")
        cur = await db.execute("SELECT name, slug, description FROM databases WHERE id = ?", (did,))
        row = await cur.fetchone()
    assert (row["name"], row["slug"], row["description"]) == ("New", "new_slug", "d")


@pytest.mark.asyncio
async def test_delete_database_cascades(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await dbs.create_column(db, did, "A", "a", "text", None)
        await dbs.create_row(db, did, {"a": "v"})
        await dbs.delete_database(db, did)
        cur = await db.execute("SELECT COUNT(*) AS n FROM database_columns WHERE database_id = ?", (did,))
        assert (await cur.fetchone())["n"] == 0
