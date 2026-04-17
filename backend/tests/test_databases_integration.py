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
