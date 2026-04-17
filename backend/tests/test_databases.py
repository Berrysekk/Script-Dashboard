import json
from pathlib import Path

import pytest

from backend import db as _db
from backend.services import databases as dbs
from backend.services import auth as auth_service


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


@pytest.mark.asyncio
async def test_create_column_appends_position(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        cid1 = await dbs.create_column(db, did, "IP", "ip", "text", None)
        cid2 = await dbs.create_column(db, did, "Port", "port", "number", None)
        cur = await db.execute(
            "SELECT id, position FROM database_columns WHERE database_id = ? ORDER BY position",
            (did,),
        )
        rows = [(r["id"], r["position"]) for r in await cur.fetchall()]
    assert rows == [(cid1, 0), (cid2, 1)]


@pytest.mark.asyncio
async def test_create_column_rejects_duplicate_key(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await dbs.create_column(db, did, "IP", "ip", "text", None)
        with pytest.raises(ValueError):
            await dbs.create_column(db, did, "IP2", "ip", "text", None)


@pytest.mark.asyncio
async def test_create_column_rejects_bad_type(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        with pytest.raises(ValueError):
            await dbs.create_column(db, did, "bad", "bad", "blob", None)


@pytest.mark.asyncio
async def test_max_columns_cap(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        for i in range(dbs.MAX_COLS_PER_DB):
            await dbs.create_column(db, did, f"C{i}", f"c{i}", "text", None)
        with pytest.raises(ValueError):
            await dbs.create_column(db, did, "over", "over", "text", None)


@pytest.mark.asyncio
async def test_delete_column_drops_from_rows(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        cid = await dbs.create_column(db, did, "IP", "ip", "text", None)
        await dbs.create_row(db, did, {"ip": "1.1.1.1"})
        await dbs.delete_column(db, did, cid)
        cur = await db.execute("SELECT values_json FROM database_rows WHERE database_id = ?", (did,))
        vj = (await cur.fetchone())["values_json"]
    assert json.loads(vj) == {}


@pytest.mark.asyncio
async def test_reorder_columns(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        a = await dbs.create_column(db, did, "A", "a", "text", None)
        b = await dbs.create_column(db, did, "B", "b", "text", None)
        await dbs.reorder_columns(db, did, [b, a])
        cur = await db.execute(
            "SELECT id FROM database_columns WHERE database_id = ? ORDER BY position",
            (did,),
        )
        order = [r["id"] for r in await cur.fetchall()]
    assert order == [b, a]


@pytest.mark.asyncio
async def test_create_row_coerces_and_stores(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await dbs.create_column(db, did, "IP", "ip", "text", None)
        await dbs.create_column(db, did, "Port", "port", "number", None)
        await dbs.create_column(db, did, "TLS", "tls", "boolean", None)
        rid = await dbs.create_row(db, did, {"ip": "1.1.1.1", "port": "554", "tls": "true"})
        cur = await db.execute("SELECT values_json FROM database_rows WHERE id = ?", (rid,))
        vals = json.loads((await cur.fetchone())["values_json"])
    assert vals == {"ip": "1.1.1.1", "port": 554, "tls": True}


@pytest.mark.asyncio
async def test_create_row_aggregates_errors(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await dbs.create_column(db, did, "Port", "port", "number", None)
        await dbs.create_column(db, did, "TLS", "tls", "boolean", None)
        with pytest.raises(dbs.RowValidationError) as ei:
            await dbs.create_row(db, did, {"port": "bad", "tls": "maybe"})
    assert set(ei.value.errors.keys()) == {"port", "tls"}


@pytest.mark.asyncio
async def test_row_size_cap(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await dbs.create_column(db, did, "Blob", "blob", "long_text", None)
        with pytest.raises(ValueError):
            await dbs.create_row(db, did, {"blob": "a" * (dbs.MAX_ROW_BYTES + 100)})


@pytest.mark.asyncio
async def test_max_rows_cap(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await dbs.create_column(db, did, "N", "n", "number", None)
        for i in range(dbs.MAX_ROWS_PER_DB):
            await dbs.create_row(db, did, {"n": i})
        with pytest.raises(ValueError):
            await dbs.create_row(db, did, {"n": 9999})


@pytest.mark.asyncio
async def test_update_row_partial(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await dbs.create_column(db, did, "A", "a", "text", None)
        await dbs.create_column(db, did, "B", "b", "text", None)
        rid = await dbs.create_row(db, did, {"a": "alpha", "b": "beta"})
        await dbs.update_row(db, did, rid, {"a": "ALPHA"})
        cur = await db.execute("SELECT values_json FROM database_rows WHERE id = ?", (rid,))
        vals = json.loads((await cur.fetchone())["values_json"])
    assert vals == {"a": "ALPHA", "b": "beta"}


@pytest.mark.asyncio
async def test_reorder_rows(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await dbs.create_column(db, did, "N", "n", "number", None)
        r1 = await dbs.create_row(db, did, {"n": 1})
        r2 = await dbs.create_row(db, did, {"n": 2})
        await dbs.reorder_rows(db, did, [r2, r1])
        cur = await db.execute(
            "SELECT id FROM database_rows WHERE database_id = ? ORDER BY position",
            (did,),
        )
        order = [r["id"] for r in await cur.fetchall()]
    assert order == [r2, r1]


@pytest.mark.asyncio
async def test_materialize_admin_sees_all(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        await db.execute(
            "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
            ("u_admin", "admin_user", "x", "admin"),
        )
        await db.execute(
            "INSERT INTO scripts (id, name, filename, owner_id) VALUES (?, ?, ?, ?)",
            ("s1", "S", "s.py", "u_admin"),
        )
        did = await dbs.create_database(db, "NVR", "nvr_list", None)
        await dbs.create_column(db, did, "IP", "ip", "text", None)
        await dbs.create_row(db, did, {"ip": "1.2.3.4"})
        await db.commit()
        script_dir = tmp_path / "s1"
        script_dir.mkdir()
        await dbs.materialize_for_script(db, "s1", script_dir)
    out = json.loads((script_dir / "databases" / "nvr_list.json").read_text())
    assert out == [{"ip": "1.2.3.4"}]


@pytest.mark.asyncio
async def test_materialize_role_scoped(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        await db.execute(
            "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
            ("u", "op", "x", "ops"),
        )
        await db.execute(
            "INSERT INTO roles (name) VALUES (?)", ("ops",)
        )
        await db.execute(
            "INSERT INTO scripts (id, name, filename, owner_id) VALUES (?, ?, ?, ?)",
            ("s1", "S", "s.py", "u"),
        )
        visible = await dbs.create_database(db, "Visible", "visible", None)
        hidden = await dbs.create_database(db, "Hidden", "hidden", None)
        await dbs.create_column(db, visible, "X", "x", "text", None)
        await dbs.create_row(db, visible, {"x": "yes"})
        await dbs.create_column(db, hidden, "X", "x", "text", None)
        await dbs.create_row(db, hidden, {"x": "no"})
        await db.execute(
            "INSERT INTO role_databases (role_name, database_id) VALUES (?, ?)",
            ("ops", visible),
        )
        await db.commit()
        script_dir = tmp_path / "s1"
        script_dir.mkdir()
        await dbs.materialize_for_script(db, "s1", script_dir)
    assert (script_dir / "databases" / "visible.json").exists()
    assert not (script_dir / "databases" / "hidden.json").exists()


@pytest.mark.asyncio
async def test_materialize_orphan_script_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        await db.execute(
            "INSERT INTO scripts (id, name, filename, owner_id) VALUES (?, ?, ?, ?)",
            ("s1", "S", "s.py", None),
        )
        await dbs.create_database(db, "X", "x", None)
        await db.commit()
        script_dir = tmp_path / "s1"
        script_dir.mkdir()
        await dbs.materialize_for_script(db, "s1", script_dir)
    dbs_dir = script_dir / "databases"
    assert dbs_dir.exists()
    assert list(dbs_dir.iterdir()) == []


@pytest.mark.asyncio
async def test_materialize_wipes_stale_files(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        await db.execute(
            "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
            ("u", "adm", "x", "admin"),
        )
        await db.execute(
            "INSERT INTO scripts (id, name, filename, owner_id) VALUES (?, ?, ?, ?)",
            ("s1", "S", "s.py", "u"),
        )
        await db.commit()
        script_dir = tmp_path / "s1"
        (script_dir / "databases").mkdir(parents=True)
        (script_dir / "databases" / "stale.json").write_text("[]")
        await dbs.materialize_for_script(db, "s1", script_dir)
    assert not (script_dir / "databases" / "stale.json").exists()


@pytest.mark.asyncio
async def test_role_database_grants_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await auth_service.create_role(db, "ops", script_ids=[], category_ids=[], database_ids=[did])
        roles = await auth_service.list_roles(db)
        ops = next(r for r in roles if r["name"] == "ops")
    assert did in ops["database_ids"]


@pytest.mark.asyncio
async def test_role_delete_cleans_role_databases(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.db.DATA_DIR", tmp_path)
    monkeypatch.setattr("backend.db.DB_PATH", tmp_path / "script-database")
    monkeypatch.setattr("backend.db.SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr("backend.db.LOGS_DIR", tmp_path / "logs")
    await _db.init_db()
    async with _db.get_db() as db:
        did = await dbs.create_database(db, "X", "x", None)
        await auth_service.create_role(db, "ops", script_ids=[], category_ids=[], database_ids=[did])
        await auth_service.delete_role(db, "ops")
        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM role_databases WHERE role_name = ?", ("ops",)
        )
        count = (await cur.fetchone())["n"]
    assert count == 0
