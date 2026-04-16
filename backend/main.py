import asyncio
import os
from contextlib import asynccontextmanager
from urllib.parse import urlparse
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from backend.db import init_db, get_db
from backend.routes import auth, scripts, runs, categories
from backend.services.log_manager import prune_old_runs
from backend.services import auth as auth_service
from backend.services import executor


async def _daily_prune() -> None:
    """Prune old runs + expired sessions once per day, forever."""
    while True:
        await prune_old_runs(retention_days=30)
        async with get_db() as db:
            await auth_service.purge_expired_sessions(db)
        await asyncio.sleep(86400)


async def _restore_loops() -> None:
    """Re-register loop tasks for scripts that were looping before container restart."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, loop_interval FROM scripts "
            "WHERE loop_enabled=1 AND loop_interval IS NOT NULL"
        )
        rows = await cur.fetchall()
    for row in rows:
        await executor.start_loop(row["id"], row["loop_interval"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _restore_loops()
    asyncio.create_task(_daily_prune())
    yield


app = FastAPI(lifespan=lifespan)


# ── CSRF defence-in-depth (Origin/Referer check) ────────────────────────────
#
# The session cookie is already ``SameSite=Strict``, which blocks the vast
# majority of CSRF, but we add an Origin/Referer allow-list as a second line
# of defence. Any state-changing request must either:
#   - originate from an allowed Origin, or
#   - have no Origin/Referer at all (i.e. not from a browser — e.g. curl,
#     CLI, mobile). We allow these because they already require the session
#     cookie to be attached explicitly.
#
# Allowed origins can be configured via ``SESSION_ALLOWED_ORIGINS`` (comma-
# separated). If unset we default to same-origin by comparing against the
# request's Host header.
_STATE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_CSRF_EXEMPT_PATHS = {
    # Public endpoints that must accept cross-origin browsers by design.
    "/api/auth/login",
    "/api/auth/reset-password",
}
_ALLOWED_ORIGINS = {
    o.strip().rstrip("/")
    for o in os.environ.get("SESSION_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
}


def _origin_host(header: str | None) -> str | None:
    if not header:
        return None
    try:
        parsed = urlparse(header)
    except ValueError:
        return None
    return parsed.netloc or None


@app.middleware("http")
async def csrf_origin_check(request: Request, call_next):
    if request.method in _STATE_METHODS and request.url.path not in _CSRF_EXEMPT_PATHS:
        origin = request.headers.get("origin")
        referer = request.headers.get("referer")
        # Non-browser clients (curl, scripts, WebSocket upgrades) send no
        # Origin — they still need a session cookie so CSRF doesn't apply.
        if origin or referer:
            allowed = set(_ALLOWED_ORIGINS)
            host = request.headers.get("host")
            if host:
                # Same-origin fallback: build origins from the Host header so
                # the app works out of the box without explicit configuration.
                allowed.update({
                    f"http://{host}".rstrip("/"),
                    f"https://{host}".rstrip("/"),
                })
            header_origin = (origin or "").rstrip("/")
            if header_origin and header_origin not in allowed:
                # Try netloc-only match for referer.
                ref_host = _origin_host(referer)
                if not (ref_host and ref_host == host):
                    return JSONResponse(
                        {"detail": "Cross-origin request blocked"},
                        status_code=403,
                    )
    return await call_next(request)


app.include_router(auth.router, prefix="/api")
app.include_router(scripts.router, prefix="/api")
app.include_router(runs.router, prefix="/api")
app.include_router(runs.ws_router)
app.include_router(categories.router, prefix="/api")
