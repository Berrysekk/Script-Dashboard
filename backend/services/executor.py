import asyncio
import uuid
from datetime import datetime, date, timedelta
from pathlib import Path
import backend.db as _db
from backend.services.venv_manager import venv_exists, create_venv
from backend.services.log_manager import log_path_for_run

# run_id -> list[asyncio.Queue]  — one Queue per connected WebSocket client
_ws_queues: dict[str, list[asyncio.Queue]] = {}

# script_id -> asyncio.Task
_loop_tasks: dict[str, asyncio.Task] = {}

# script_id -> datetime of next scheduled run
_next_run: dict[str, datetime] = {}


def parse_interval(interval: str) -> int:
    """
    Convert a user-supplied interval string to an integer number of seconds.

    Supported suffixes:
        s  — seconds   e.g. "30s"  → 30
        m  — minutes   e.g. "10m"  → 600
        h  — hours     e.g. "6h"   → 21600

    Raises:
        ValueError("Invalid interval: <interval>") for any unrecognised format,
        including empty strings, negative numbers, non-integer prefixes, or
        unknown suffix characters.

    Rules:
        - Leading/trailing whitespace is stripped
        - The numeric part must be a positive integer (zero and negatives are rejected)
        - A bare number with no suffix is invalid
        - Decimal values (e.g. "1.5h") are invalid
    """
    interval = interval.strip()
    units = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    if not interval or interval[-1] not in units:
        raise ValueError(f"Invalid interval: {interval}")
    try:
        value = int(interval[:-1])
    except ValueError:
        raise ValueError(f"Invalid interval: {interval}")
    if value <= 0:
        raise ValueError(f"Invalid interval: {interval}")
    return value * units[interval[-1]]


async def run_script(script_id: str) -> str:
    """Spawn script subprocess. Returns run_id immediately (fire-and-forget)."""
    run_id = str(uuid.uuid4())
    script_dir = _db.SCRIPTS_DIR / script_id
    log_file_path = log_path_for_run(script_id, run_id, date.today())

    async with _db.get_db() as db:
        await db.execute(
            "INSERT INTO runs (id, script_id, log_path, status) VALUES (?, ?, ?, 'running')",
            (run_id, script_id,
             str(log_file_path.relative_to(_db.LOGS_DIR))),
        )
        await db.commit()

    asyncio.create_task(_execute(script_id, run_id, script_dir, log_file_path))
    return run_id


async def _broadcast(run_id: str, line: str) -> None:
    """Push a log line to all WebSocket queues watching this run."""
    for q in list(_ws_queues.get(run_id, [])):
        await q.put(line)


async def _execute(
    script_id: str,
    run_id: str,
    script_dir: Path,
    log_path: Path,
) -> None:
    """Run the script subprocess, stream output to log file + WebSocket queues."""
    import os as _os
    _ws_queues[run_id] = []

    with open(log_path, "w", buffering=1) as lf:
        def emit(line: str) -> None:
            lf.write(line)
            lf.flush()
            asyncio.get_event_loop().create_task(_broadcast(run_id, line))

        if not venv_exists(script_dir):
            lf.write("=== Setting up virtual environment ===\n")
            await create_venv(script_dir, emit)

        run_env = {**_os.environ, "SCRIPT_OUTPUT_DIR": str(script_dir / "output")}
        venv_python = script_dir / "venv" / "bin" / "python"
        proc = await asyncio.create_subprocess_exec(
            str(venv_python),
            str(script_dir / "script.py"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(script_dir),
            env=run_env,
        )
        async for raw in proc.stdout:
            emit(raw.decode())
        await proc.wait()
        exit_code = proc.returncode

    # Signal end-of-stream to all WebSocket listeners
    for q in list(_ws_queues.get(run_id, [])):
        await q.put(None)
    _ws_queues.pop(run_id, None)

    if exit_code == 0:
        status = "success"
    elif exit_code is not None and exit_code >= 128:
        status = "error"    # killed by signal / hard crash
    else:
        status = "warning"  # script ran but reported failures (e.g. sys.exit(1))
    async with _db.get_db() as db:
        await db.execute(
            "UPDATE runs SET finished_at=datetime('now'), exit_code=?, status=? WHERE id=?",
            (exit_code, status, run_id),
        )
        await db.commit()


def get_next_run(script_id: str) -> str | None:
    """Return ISO timestamp of next scheduled run, or None if not looping."""
    dt = _next_run.get(script_id)
    return dt.isoformat() if dt else None


def is_looping(script_id: str) -> bool:
    """Return True if a loop task is active for this script."""
    task = _loop_tasks.get(script_id)
    return task is not None and not task.done()


async def start_loop(script_id: str, interval: str) -> None:
    """Start a looping run task for script_id. No-op if already looping."""
    if is_looping(script_id):
        return
    seconds = parse_interval(interval)
    _loop_tasks[script_id] = asyncio.create_task(
        _loop_worker(script_id, seconds)
    )
    async with _db.get_db() as db:
        await db.execute(
            "UPDATE scripts SET loop_enabled=1, loop_interval=? WHERE id=?",
            (interval, script_id),
        )
        await db.commit()


async def stop_loop(script_id: str) -> None:
    """Cancel the loop task for script_id and clear loop state in DB."""
    task = _loop_tasks.pop(script_id, None)
    if task and not task.done():
        task.cancel()
    _next_run.pop(script_id, None)
    async with _db.get_db() as db:
        await db.execute(
            "UPDATE scripts SET loop_enabled=0 WHERE id=?",
            (script_id,),
        )
        await db.commit()


async def _loop_worker(script_id: str, seconds: int) -> None:
    """Repeatedly run script_id every `seconds` seconds until cancelled."""
    try:
        while True:
            try:
                await run_script(script_id)
            except Exception as exc:
                # Script launch failed — log and keep looping
                import logging
                logging.getLogger(__name__).error(
                    "Loop run failed for %s: %s", script_id, exc
                )
            _next_run[script_id] = datetime.now() + timedelta(seconds=seconds)
            await asyncio.sleep(seconds)
    except asyncio.CancelledError:
        _next_run.pop(script_id, None)
        raise
