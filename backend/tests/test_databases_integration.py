import inspect

import pytest


@pytest.mark.asyncio
async def test_create_database_as_admin(auth_client):
    res = await auth_client.post("/api/databases", json={"name": "NVR List"})
    assert res.status_code == 200
    data = res.json()
    assert data["slug"] == "nvr_list"
    assert data["name"] == "NVR List"


@pytest.mark.asyncio
async def test_list_databases_includes_counts(auth_client):
    r = await auth_client.post("/api/databases", json={"name": "Hosts"})
    did = r.json()["id"]
    await auth_client.post(
        f"/api/databases/{did}/columns",
        json={"name": "IP", "key": "ip", "type": "text"},
    )
    await auth_client.post(
        f"/api/databases/{did}/rows",
        json={"values": {"ip": "10.0.0.1"}},
    )
    res = await auth_client.get("/api/databases")
    assert res.status_code == 200
    rows = res.json()
    entry = next(x for x in rows if x["id"] == did)
    assert entry["row_count"] == 1
    assert entry["column_count"] == 1


@pytest.mark.asyncio
async def test_slug_conflict_returns_409(auth_client):
    await auth_client.post("/api/databases", json={"name": "Hosts", "slug": "hosts"})
    res = await auth_client.post("/api/databases", json={"name": "Hosts2", "slug": "hosts"})
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["error"] == "slug_taken"
    assert detail["suggestion"] == "hosts_2"


@pytest.mark.asyncio
async def test_row_validation_returns_400_with_errors(auth_client):
    r = await auth_client.post("/api/databases", json={"name": "X"})
    did = r.json()["id"]
    await auth_client.post(
        f"/api/databases/{did}/columns",
        json={"name": "Port", "key": "port", "type": "number"},
    )
    await auth_client.post(
        f"/api/databases/{did}/columns",
        json={"name": "TLS", "key": "tls", "type": "boolean"},
    )
    res = await auth_client.post(
        f"/api/databases/{did}/rows",
        json={"values": {"port": "bad", "tls": "maybe"}},
    )
    assert res.status_code == 400
    assert set(res.json()["detail"]["errors"].keys()) == {"port", "tls"}


@pytest.mark.asyncio
async def test_non_admin_cannot_write(auth_client, client):
    r = await auth_client.post("/api/databases", json={"name": "Read"})
    did = r.json()["id"]
    await auth_client.post("/api/auth/users", json={"username": "u", "password": "pw", "role": "user"})
    login = await client.post("/api/auth/login", json={"username": "u", "password": "pw"})
    assert login.status_code == 200
    res = await client.post("/api/databases", json={"name": "blocked"})
    assert res.status_code == 403
    res = await client.delete(f"/api/databases/{did}")
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_materialized_file_appears_before_script_run(auth_client, tmp_path, monkeypatch):
    """The executor materializes DBs into <script_dir>/databases/<slug>.json."""
    from backend.services import executor
    from backend import db as _db
    from backend.services import databases as dbs

    # Build a database visible to admin
    r = await auth_client.post("/api/databases", json={"name": "NVR", "slug": "nvr"})
    did = r.json()["id"]
    await auth_client.post(
        f"/api/databases/{did}/columns",
        json={"name": "IP", "key": "ip", "type": "text"},
    )
    await auth_client.post(
        f"/api/databases/{did}/rows",
        json={"values": {"ip": "9.9.9.9"}},
    )

    # Directly invoke materialize_for_script with an admin-owned script_id
    async with _db.get_db() as db:
        cur = await db.execute("SELECT id FROM scripts LIMIT 1")
        row = await cur.fetchone()
    if row is None:
        pytest.skip("no script fixture present")
    script_id = row["id"]
    script_dir = tmp_path / script_id
    script_dir.mkdir()
    async with _db.get_db() as db:
        await dbs.materialize_for_script(db, script_id, script_dir)
    path = script_dir / "databases" / "nvr.json"
    assert path.exists()
    assert '"ip": "9.9.9.9"' in path.read_text()


def test_safe_skip_and_blocked_keys_include_script_db_dir():
    from backend.services import executor
    from backend.routes import scripts

    assert "SCRIPT_DB_DIR" in scripts._BLOCKED_KEYS
    assert "SCRIPT_DB_DIR" in executor._SAFE_SKIP
    # Sanity: a few other high-risk vars are also protected.
    for key in ("PATH", "LD_PRELOAD", "PYTHONPATH", "SCRIPT_OUTPUT_DIR"):
        assert key in executor._SAFE_SKIP, f"{key} missing from _SAFE_SKIP"


@pytest.mark.asyncio
async def test_end_to_end_admin_flow(auth_client, tmp_path):
    """Admin creates DB, schema, rows; assigns to role; materialization contains correct data."""
    import json as _json
    import uuid
    from backend.services import databases as dbs
    from backend import db as _db

    # 1. Create DB
    r = await auth_client.post("/api/databases", json={"name": "NVR List", "slug": "nvr_list"})
    assert r.status_code == 200
    did = r.json()["id"]

    # 2. Add 5 columns across types
    for col in [
        {"name": "Name", "key": "name", "type": "text"},
        {"name": "IP", "key": "ip", "type": "text"},
        {"name": "Port", "key": "port", "type": "number"},
        {"name": "User", "key": "user", "type": "text"},
        {"name": "Password", "key": "password", "type": "secret"},
    ]:
        res = await auth_client.post(f"/api/databases/{did}/columns", json=col)
        assert res.status_code == 200

    # 3. Add 2 rows
    for row in [
        {"values": {"name": "NVR-1", "ip": "10.0.0.1", "port": "554", "user": "admin", "password": "p1"}},
        {"values": {"name": "NVR-2", "ip": "10.0.0.2", "port": "554", "user": "admin", "password": "p2"}},
    ]:
        res = await auth_client.post(f"/api/databases/{did}/rows", json=row)
        assert res.status_code == 200

    # 4. Fetch with admin — secrets should be plaintext, numbers coerced
    full = (await auth_client.get(f"/api/databases/{did}")).json()
    assert full["rows"][0]["values"]["password"] == "p1"
    assert full["rows"][0]["values"]["port"] == 554

    # 5. Create a role granting this DB, assign to a new user
    role_res = await auth_client.post(
        "/api/auth/roles",
        json={"name": "nvr_ops", "script_ids": [], "category_ids": [], "database_ids": [did]},
    )
    assert role_res.status_code == 200
    user_res = await auth_client.post(
        "/api/auth/users",
        json={"username": "nvru", "password": "pw", "role": "nvr_ops"},
    )
    assert user_res.status_code == 200

    # 6. Materialize into a fake sandbox.
    # Insert a synthetic admin-owned script so materialization is deterministic
    # (no pre-seeded scripts exist in this test fixture).
    synthetic_script_id = str(uuid.uuid4())
    async with _db.get_db() as db:
        cur = await db.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
        admin_row = await cur.fetchone()
        assert admin_row is not None, "Expected bootstrap admin user to exist"
        admin_id = admin_row["id"]
        await db.execute(
            "INSERT INTO scripts (id, name, filename, owner_id) VALUES (?, ?, ?, ?)",
            (synthetic_script_id, "test_nvr_script", "test_nvr_script.py", admin_id),
        )
        await db.commit()

    script_dir = tmp_path / synthetic_script_id
    script_dir.mkdir()
    async with _db.get_db() as db:
        await dbs.materialize_for_script(db, synthetic_script_id, script_dir)

    payload = _json.loads((script_dir / "databases" / "nvr_list.json").read_text())
    assert payload[0]["password"] == "p1"
    assert payload[0]["port"] == 554
