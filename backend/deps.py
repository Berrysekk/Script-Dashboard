"""FastAPI dependencies that enforce session auth on HTTP + WebSocket routes."""
from fastapi import Depends, HTTPException, Request, WebSocket

from backend.db import get_db
from backend.services import auth as auth_service

COOKIE_NAME = "sd_session"


async def current_user(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    async with get_db() as db:
        user = await auth_service.get_session_user(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


async def require_admin(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return user


async def ws_current_user(websocket: WebSocket):
    """Validate the session cookie on a WebSocket handshake.

    Returns the user row, or ``None`` after closing the socket with policy
    violation (1008). Callers should bail out on None *before* ``accept()``.
    """
    token = websocket.cookies.get(COOKIE_NAME)
    if not token:
        await websocket.close(code=1008)
        return None
    async with get_db() as db:
        user = await auth_service.get_session_user(db, token)
    if not user:
        await websocket.close(code=1008)
        return None
    return user
