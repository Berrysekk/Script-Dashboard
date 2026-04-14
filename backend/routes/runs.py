import asyncio
import backend.db as _db
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from backend.deps import current_user, ws_current_user
from backend.services import executor

router = APIRouter()
ws_router = APIRouter()


async def _run_and_script_for(run_id: str):
    """Return (run_row, script_row) or (None, None) if either is missing."""
    async with _db.get_db() as db:
        cur = await db.execute("SELECT * FROM runs WHERE id=?", (run_id,))
        run = await cur.fetchone()
        if not run:
            return None, None
        cur = await db.execute(
            "SELECT id, owner_id FROM scripts WHERE id=?", (run["script_id"],)
        )
        script = await cur.fetchone()
    return run, script


def _can_see(user, script_row) -> bool:
    if script_row is None:
        return False
    if user["role"] == "admin":
        return True
    return script_row["owner_id"] == user["id"]


@router.get("/runs/{run_id}")
async def get_run(run_id: str, user=Depends(current_user)):
    run, script = await _run_and_script_for(run_id)
    if not run or not _can_see(user, script):
        raise HTTPException(404, "Run not found")
    return dict(run)


@router.get("/runs/{run_id}/log")
async def download_log(run_id: str, user=Depends(current_user)):
    run, script = await _run_and_script_for(run_id)
    if not run or not _can_see(user, script):
        raise HTTPException(404, "Run not found")
    log_file = _db.LOGS_DIR / run["log_path"]
    if not log_file.exists():
        raise HTTPException(404, "Log file not found")
    return FileResponse(log_file, filename=f"{run_id}.log", media_type="text/plain")


async def ws_run_log(websocket: WebSocket, run_id: str):
    user = await ws_current_user(websocket)
    if user is None:
        return

    run, script = await _run_and_script_for(run_id)
    if not run or not _can_see(user, script):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue()
    executor._ws_queues.setdefault(run_id, []).append(queue)
    try:
        while True:
            line = await queue.get()
            if line is None:   # sentinel — run finished
                break
            await websocket.send_text(line)
    except WebSocketDisconnect:
        pass
    finally:
        lst = executor._ws_queues.get(run_id, [])
        if queue in lst:
            lst.remove(queue)


@ws_router.websocket("/ws/runs/{run_id}")
async def _ws_run_log(websocket: WebSocket, run_id: str):
    await ws_run_log(websocket, run_id)
