import pytest, io

@pytest.mark.asyncio
async def test_upload_script(client):
    res = await client.post(
        "/api/scripts",
        files={"file": ("hello.py", io.BytesIO(b'print("hello")'), "text/plain")},
        data={"name": "Hello", "description": "Test"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "Hello"
    assert data["filename"] == "hello.py"
    assert "id" in data

@pytest.mark.asyncio
async def test_list_scripts(client):
    await client.post(
        "/api/scripts",
        files={"file": ("a.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "A"},
    )
    res = await client.get("/api/scripts")
    assert res.status_code == 200
    assert len(res.json()) == 1

@pytest.mark.asyncio
async def test_get_script_detail(client):
    upload = await client.post(
        "/api/scripts",
        files={"file": ("b.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "B"},
    )
    sid = upload.json()["id"]
    resp = await client.get(f"/api/scripts/{sid}")
    assert resp.status_code == 200
    assert resp.json()["id"] == sid

@pytest.mark.asyncio
async def test_patch_script(client):
    upload = await client.post(
        "/api/scripts",
        files={"file": ("c.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "Old Name"},
    )
    sid = upload.json()["id"]
    resp = await client.patch(f"/api/scripts/{sid}", json={"name": "New Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"

@pytest.mark.asyncio
async def test_delete_script(client):
    upload = await client.post(
        "/api/scripts",
        files={"file": ("d.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "D"},
    )
    sid = upload.json()["id"]
    await client.delete(f"/api/scripts/{sid}")
    resp = await client.get(f"/api/scripts/{sid}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_output_list_empty(client):
    upload = await client.post(
        "/api/scripts",
        files={"file": ("out.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "Out"},
    )
    sid = upload.json()["id"]
    res = await client.get(f"/api/scripts/{sid}/output")
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
async def test_output_list_after_write(client):
    import backend.db as db_module
    upload = await client.post(
        "/api/scripts",
        files={"file": ("out2.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "Out2"},
    )
    sid = upload.json()["id"]
    out_dir = db_module.SCRIPTS_DIR / sid / "output"
    (out_dir / "result.csv").write_text("a,b,c")
    res = await client.get(f"/api/scripts/{sid}/output")
    assert len(res.json()) == 1
    assert res.json()[0]["filename"] == "result.csv"
