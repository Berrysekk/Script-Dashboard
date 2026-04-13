import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from backend.db import init_db, get_db
from backend.routes import scripts, runs
from backend.services.log_manager import prune_old_runs
from backend.services import executor


async def _daily_prune() -> None:
    """Prune old runs once per day, forever."""
    while True:
        await prune_old_runs(retention_days=30)
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
app.include_router(scripts.router, prefix="/api")
app.include_router(runs.router, prefix="/api")
app.include_router(runs.ws_router)
