"""Authentication routes: login, logout, session introspection, user CRUD, reset."""
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

router = APIRouter()

_SESSION_MAX_AGE_DAYS = 7


def _user_public(user) -> dict:
    return {"id": user["id"], "username": user["username"], "role": user["role"]}


@router.post("/auth/login")
async def login(body: LoginRequest, response: Response):
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
        samesite="lax",
        max_age=_SESSION_MAX_AGE_DAYS * 86400,
        path="/",
    )
    return _user_public(user)


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
async def reset_password(body: ResetPasswordRequest):
    """Public endpoint: reset a user's password using the shared master password.

    On success, all of the target user's existing sessions are invalidated so
    any attacker currently logged in as them gets kicked.
    """
    if not auth_service.verify_master_password(body.master_password):
        auth_service.dummy_verify()  # flatten timing
        raise HTTPException(status_code=401, detail="Invalid master password")
    async with get_db() as db:
        target = await auth_service.get_user_by_username(db, body.username)
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        await auth_service.set_password(db, target["id"], body.new_password)
        await auth_service.delete_user_sessions(db, target["id"])
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
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
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
    return {"ok": True}
