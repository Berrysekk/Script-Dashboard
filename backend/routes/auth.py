"""Authentication routes: login, logout, session introspection, user CRUD, reset."""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from backend.db import get_db
from backend.deps import COOKIE_NAME, current_user, require_admin
from backend.models import (
    ChangePasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    RoleCreateRequest,
    RoleUpdateRequest,
    UserCreateRequest,
)
from backend.services import auth as auth_service
from backend.services.rate_limit import enforce_rate_limit

_log = logging.getLogger(__name__)

router = APIRouter()

_SESSION_MAX_AGE_DAYS = 7

# Force Secure cookies regardless of request scheme. Set in production so
# the session cookie is never emitted over plain HTTP. In tests / local
# dev it's "0", and we fall back to detecting https from the request.
_COOKIE_SECURE_FORCED: bool = os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"


def _is_secure_request(request: Request) -> bool:
    """True if the request arrived over HTTPS (including via a trusted proxy)."""
    if _COOKIE_SECURE_FORCED:
        return True
    if request.url.scheme == "https":
        return True
    # Honour X-Forwarded-Proto when the app is behind a reverse proxy. The
    # operator is responsible for stripping/normalising this header at the
    # proxy layer — we treat its presence as authoritative by design.
    return request.headers.get("x-forwarded-proto", "").lower() == "https"


def _user_public(user) -> dict:
    return {"id": user["id"], "username": user["username"], "role": user["role"]}


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request, response: Response):
    # Per-IP throttle. 10 attempts / minute is generous for humans but kills
    # credential-stuffing scripts.
    enforce_rate_limit(f"login:{_client_ip(request)}", limit=10, window_seconds=60)

    async with get_db() as db:
        user = await auth_service.get_user_by_username(db, body.username)
        if not user:
            # Burn time so that "no such user" and "wrong password" take
            # roughly the same wall-clock time.
            auth_service.dummy_verify()
            raise HTTPException(status_code=401, detail="Invalid credentials")
        if not auth_service.verify_password(body.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        token = await auth_service.create_session(db, user["id"], _SESSION_MAX_AGE_DAYS)

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        secure=_is_secure_request(request),
        max_age=_SESSION_MAX_AGE_DAYS * 86400,
        path="/",
    )
    return _user_public(user)


def _client_ip(request: Request) -> str:
    """Best-effort remote address for rate-limit bucket keys."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/auth/logout")
async def logout(request: Request, response: Response, user=Depends(current_user)):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        async with get_db() as db:
            await auth_service.delete_session(db, token)
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/auth/me")
async def me(user=Depends(current_user)):
    return _user_public(user)


@router.post("/auth/change-password")
async def change_password(body: ChangePasswordRequest, user=Depends(current_user)):
    if not auth_service.verify_password(body.old_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Old password incorrect")
    async with get_db() as db:
        await auth_service.set_password(db, user["id"], body.new_password)
    return {"ok": True}


@router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordRequest, request: Request):
    """Public endpoint: reset a user's password using the shared master password.

    On success, all of the target user's existing sessions are invalidated so
    any attacker currently logged in as them gets kicked.
    """
    # Strict per-IP cap + global cap. This endpoint is pre-auth and verifies
    # against a single shared secret, so brute-force protection is critical.
    enforce_rate_limit(f"reset:{_client_ip(request)}", limit=5, window_seconds=900)
    enforce_rate_limit("reset:global", limit=30, window_seconds=900)

    if not auth_service.verify_master_password(body.master_password):
        auth_service.dummy_verify()  # flatten timing
        raise HTTPException(status_code=401, detail="Invalid master password")
    async with get_db() as db:
        target = await auth_service.get_user_by_username(db, body.username)
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await auth_service.set_password(db, target["id"], body.new_password)
        await auth_service.delete_user_sessions(db, target["id"])
    _log.info("password reset via master for user %s", target["id"])
    return {"ok": True}


@router.get("/auth/users")
async def list_users(admin=Depends(require_admin)):
    async with get_db() as db:
        rows = await auth_service.list_users(db)
    return [
        {
            "id": r["id"],
            "username": r["username"],
            "role": r["role"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.post("/auth/users")
async def create_user(body: UserCreateRequest, admin=Depends(require_admin)):
    async with get_db() as db:
        cur = await db.execute("SELECT 1 FROM roles WHERE name = ?", (body.role,))
        if not await cur.fetchone():
            raise HTTPException(status_code=400, detail=f"Role '{body.role}' does not exist")
        existing = await auth_service.get_user_by_username(db, body.username)
        if existing:
            raise HTTPException(status_code=409, detail="Username already exists")
        user_id = await auth_service.create_user(db, body.username, body.password, body.role)
    return {"id": user_id, "username": body.username, "role": body.role}


# ── Role management ────────────────────────────────────────────────────────

@router.get("/auth/roles")
async def list_roles(admin=Depends(require_admin)):
    async with get_db() as db:
        return await auth_service.list_roles(db)


@router.post("/auth/roles")
async def create_role(body: RoleCreateRequest, admin=Depends(require_admin)):
    async with get_db() as db:
        try:
            await auth_service.create_role(db, body.name, body.script_ids)
        except ValueError as e:
            # Known validation errors are safe to surface verbatim.
            raise HTTPException(status_code=400, detail=str(e))
        except Exception:
            # Anything else could leak internal state (SQL errors, paths, …).
            _log.exception("create_role failed for %r", body.name)
            raise HTTPException(status_code=400, detail="Failed to create role")
    _log.info("role created: %s by %s", body.name, admin["id"])
    return {"name": body.name}


@router.put("/auth/roles/{role_name}")
async def update_role(role_name: str, body: RoleUpdateRequest, admin=Depends(require_admin)):
    if role_name in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Cannot modify system roles")
    async with get_db() as db:
        await auth_service.update_role_scripts(db, role_name, body.script_ids)
    return {"ok": True}


@router.delete("/auth/roles/{role_name}")
async def delete_role(role_name: str, admin=Depends(require_admin)):
    async with get_db() as db:
        try:
            await auth_service.delete_role(db, role_name)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception:
            _log.exception("delete_role failed for %r", role_name)
            raise HTTPException(status_code=400, detail="Failed to delete role")
    _log.info("role deleted: %s by %s", role_name, admin["id"])
    return {"ok": True}


@router.delete("/auth/users/{user_id}")
async def delete_user(user_id: str, admin=Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    async with get_db() as db:
        target = await auth_service.get_user_by_id(db, user_id)
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await auth_service.delete_user(db, user_id)
    _log.info("user deleted: %s (%s) by %s", user_id, target["username"], admin["id"])
    return {"ok": True}
