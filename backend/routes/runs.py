import asyncio
import backend.db as _db
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse
from backend.services import executor

router = APIRouter()
ws_router = APIRouter()


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    async with _db.get_db() as db:
        cur = await db.execute("SELECT * FROM runs WHERE id=?", (run_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Run not found")
    return dict(row)


@router.get("/runs/{run_id}/log")
async def download_log(run_id: str):
    async with _db.get_db() as db:
        cur = await db.execute("SELECT log_path FROM runs WHERE id=?", (run_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Run not found")
    log_file = _db.LOGS_DIR / row["log_path"]
    if not log_file.exists():
        raise HTTPException(404, "Log file not found")
    return FileResponse(log_file, filename=f"{run_id}.log", media_type="text/plain")


async def ws_run_log(websocket: WebSocket, run_id: str):
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
