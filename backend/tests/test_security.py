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
