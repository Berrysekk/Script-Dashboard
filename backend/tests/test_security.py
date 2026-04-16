"""Security regression tests covering hardening added in the security scan PR."""
import io
import os
import zipfile

import pytest
from httpx import AsyncClient, ASGITransport

from backend.tests.conftest import TEST_ADMIN_PASSWORD, TEST_ADMIN_USER, TEST_MASTER


# ── #2 Upload size limit ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_size_limit_enforced(auth_client, monkeypatch):
    # Tighten the limit for this test so we can exercise it cheaply.
    from backend.routes import scripts as scripts_route
    monkeypatch.setattr(scripts_route, "MAX_UPLOAD_BYTES", 1024)

    big = b"x" * 2048
    res = await auth_client.post(
        "/api/scripts",
        files={"file": ("big.py", io.BytesIO(big), "text/plain")},
        data={"name": "oversize"},
    )
    assert res.status_code == 413


# ── #12 Metadata length validation ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_overlong_script_name_rejected(auth_client):
    res = await auth_client.post(
        "/api/scripts",
        files={"file": ("n.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "x" * 500},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_overlong_description_rejected(auth_client):
    res = await auth_client.post(
        "/api/scripts",
        files={"file": ("d.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "ok", "description": "x" * 20_000},
    )
    assert res.status_code == 400


# ── #14 ZIP entry traversal ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_zip_with_traversal_rejected(auth_client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../evil.py", "pass")
    buf.seek(0)
    res = await auth_client.post(
        "/api/scripts",
        files={"file": ("bad.zip", buf, "application/zip")},
        data={"name": "bad"},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_zip_without_py_rejected(auth_client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", "hi")
    buf.seek(0)
    res = await auth_client.post(
        "/api/scripts",
        files={"file": ("nopy.zip", buf, "application/zip")},
        data={"name": "nopy"},
    )
    assert res.status_code == 400


# ── #11 Path traversal + symlink rejection on output download ─────────────

@pytest.mark.asyncio
async def test_output_download_rejects_symlink(auth_client, tmp_path):
    import backend.db as db_module

    upload = await auth_client.post(
        "/api/scripts",
        files={"file": ("s.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "S"},
    )
    sid = upload.json()["id"]
    out_dir = db_module.SCRIPTS_DIR / sid / "output"

    secret = tmp_path / "secret.txt"
    secret.write_text("top-secret")
    # Drop a symlink inside the output dir pointing at a file outside it.
    link = out_dir / "escape.txt"
    os.symlink(secret, link)

    res = await auth_client.get(f"/api/scripts/{sid}/output/escape.txt")
    assert res.status_code == 400, res.text


@pytest.mark.asyncio
async def test_output_download_rejects_traversal(auth_client):
    import backend.db as db_module

    upload = await auth_client.post(
        "/api/scripts",
        files={"file": ("s.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "S"},
    )
    sid = upload.json()["id"]
    (db_module.SCRIPTS_DIR / sid / "output" / "ok.txt").write_text("ok")

    res = await auth_client.get(f"/api/scripts/{sid}/output/..%2Fok.txt")
    assert res.status_code in (400, 404)


# ── #5/#6 Rate limiting ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_rate_limit_triggers(client):
    # 10/min allowed → 11th fails closed.
    for _ in range(10):
        await client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "x"},
        )
    res = await client.post(
        "/api/auth/login",
        json={"username": "nobody", "password": "x"},
    )
    assert res.status_code == 429


@pytest.mark.asyncio
async def test_reset_password_rate_limit_triggers(client):
    # 5 per 15min per IP — 6th should 429.
    for _ in range(5):
        await client.post(
            "/api/auth/reset-password",
            json={
                "username": "whoever",
                "master_password": "wrong",
                "new_password": "x",
            },
        )
    res = await client.post(
        "/api/auth/reset-password",
        json={
            "username": "whoever",
            "master_password": "wrong",
            "new_password": "x",
        },
    )
    assert res.status_code == 429


# ── #7 CSRF Origin check ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_csrf_blocks_cross_origin_post(auth_client):
    # A POST that explicitly advertises a foreign origin is blocked.
    res = await auth_client.post(
        "/api/scripts",
        files={"file": ("x.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "x"},
        headers={"Origin": "http://evil.example"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_csrf_allows_no_origin_header(auth_client):
    # CLI / curl requests with no Origin header still work — they already
    # have to attach the session cookie explicitly.
    res = await auth_client.post(
        "/api/scripts",
        files={"file": ("x.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "x"},
    )
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_csrf_exempts_login(client):
    # /auth/login is intentionally exempt so cross-origin SPAs can still
    # sign in (their own SameSite cookie protects them afterwards).
    res = await client.post(
        "/api/auth/login",
        json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASSWORD},
        headers={"Origin": "http://evil.example"},
    )
    assert res.status_code == 200


# ── Rate-limit bucket cannot be rotated via X-Forwarded-For ─────────────────

@pytest.mark.asyncio
async def test_login_rate_limit_not_bypassable_via_xff(client):
    # nginx replaces XFF with the real peer IP, but as a defence in depth
    # the backend takes the right-most XFF entry (the one nginx guarantees).
    # A client-controlled left-most entry must not rotate the bucket.
    for i in range(10):
        await client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "x"},
            headers={"X-Forwarded-For": f"10.0.0.{i}, 127.0.0.1"},
        )
    res = await client.post(
        "/api/auth/login",
        json={"username": "nobody", "password": "x"},
        headers={"X-Forwarded-For": "10.99.99.99, 127.0.0.1"},
    )
    assert res.status_code == 429


# ── /scripts/swap requires access to both scripts ───────────────────────────

@pytest.mark.asyncio
async def test_swap_rejects_unknown_script(auth_client):
    upload = await auth_client.post(
        "/api/scripts",
        files={"file": ("a.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "A"},
    )
    sid = upload.json()["id"]
    res = await auth_client.put(
        "/api/scripts/swap",
        json={"script_id_a": sid, "script_id_b": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 404


# ── /scripts/{id}/category is admin-only ────────────────────────────────────

@pytest.mark.asyncio
async def test_set_script_category_is_admin_only(client, auth_client):
    # Admin creates a user and a script owned by that user.
    await auth_client.post(
        "/api/auth/users",
        json={"username": "alice", "password": "alicepw", "role": "user"},
    )
    # alice logs in.
    login = await client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "alicepw"},
    )
    assert login.status_code == 200
    upload = await client.post(
        "/api/scripts",
        files={"file": ("a.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "A"},
    )
    assert upload.status_code == 200
    sid = upload.json()["id"]

    # alice must not be able to reassign the category — that is an authz
    # grant change and belongs to admin.
    res = await client.put(
        f"/api/scripts/{sid}/category",
        json={"category_id": None},
    )
    assert res.status_code == 403


# ── PRAGMA foreign_keys is ON (cascades fire) ───────────────────────────────

@pytest.mark.asyncio
async def test_category_delete_cascades_to_children(auth_client):
    parent = await auth_client.post("/api/categories", json={"name": "parent"})
    parent_id = parent.json()["id"]
    child = await auth_client.post(
        "/api/categories", json={"name": "child", "parent_id": parent_id}
    )
    child_id = child.json()["id"]

    res = await auth_client.delete(f"/api/categories/{parent_id}")
    assert res.status_code == 200

    tree = await auth_client.get("/api/categories")
    ids = {c["id"] for c in tree.json()}
    assert parent_id not in ids
    # Without foreign_keys=ON the child would survive as an orphan root.
    assert child_id not in ids


# ── Output responses advertise CSP: sandbox ─────────────────────────────────

@pytest.mark.asyncio
async def test_output_inline_sets_csp_sandbox(auth_client):
    import backend.db as db_module

    upload = await auth_client.post(
        "/api/scripts",
        files={"file": ("s.py", io.BytesIO(b"pass"), "text/plain")},
        data={"name": "S"},
    )
    sid = upload.json()["id"]
    (db_module.SCRIPTS_DIR / sid / "output" / "evil.html").write_text(
        "<script>alert(1)</script>"
    )
    res = await auth_client.get(f"/api/scripts/{sid}/output/evil.html?inline=1")
    assert res.status_code == 200
    assert "sandbox" in res.headers.get("content-security-policy", "")
