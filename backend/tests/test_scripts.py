import pytest, io

@pytest.mark.asyncio
async def test_upload_script(auth_client):
    res = await auth_client.post(
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
async def test_list_scripts(auth_client):
    await auth_client.post(
        "/api/scripts",
        files={"file": ("a.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "A"},
    )
    res = await auth_client.get("/api/scripts")
    assert res.status_code == 200
    assert len(res.json()) == 1

@pytest.mark.asyncio
async def test_get_script_detail(auth_client):
    upload = await auth_client.post(
        "/api/scripts",
        files={"file": ("b.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "B"},
    )
    sid = upload.json()["id"]
    resp = await auth_client.get(f"/api/scripts/{sid}")
    assert resp.status_code == 200
    assert resp.json()["id"] == sid

@pytest.mark.asyncio
async def test_patch_script(auth_client):
    upload = await auth_client.post(
        "/api/scripts",
        files={"file": ("c.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "Old Name"},
    )
    sid = upload.json()["id"]
    resp = await auth_client.patch(f"/api/scripts/{sid}", json={"name": "New Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"

@pytest.mark.asyncio
async def test_delete_script(auth_client):
    upload = await auth_client.post(
        "/api/scripts",
        files={"file": ("d.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "D"},
    )
    sid = upload.json()["id"]
    await auth_client.delete(f"/api/scripts/{sid}")
    resp = await auth_client.get(f"/api/scripts/{sid}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_output_list_empty(auth_client):
    upload = await auth_client.post(
        "/api/scripts",
        files={"file": ("out.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "Out"},
    )
    sid = upload.json()["id"]
    res = await auth_client.get(f"/api/scripts/{sid}/output")
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
async def test_output_list_after_write(auth_client):
    import backend.db as db_module
    upload = await auth_client.post(
        "/api/scripts",
        files={"file": ("out2.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "Out2"},
    )
    sid = upload.json()["id"]
    out_dir = db_module.SCRIPTS_DIR / sid / "output"
    (out_dir / "result.csv").write_text("a,b,c")
    res = await auth_client.get(f"/api/scripts/{sid}/output")
    assert len(res.json()) == 1
    assert res.json()[0]["filename"] == "result.csv"
