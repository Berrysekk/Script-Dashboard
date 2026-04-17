import pytest
from pathlib import Path


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
    src = Path("services/executor.py").read_text()
    # Presence check on the literal string in _SAFE_SKIP
    assert '"SCRIPT_DB_DIR"' in src
