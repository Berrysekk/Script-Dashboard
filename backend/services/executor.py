import asyncio
import logging
import os as _os
import shutil as _shutil
import uuid
from datetime import datetime, date, timedelta
from pathlib import Path
import backend.db as _db
from backend.services.venv_manager import venv_exists, create_venv
from backend.services.log_manager import log_path_for_run

_log = logging.getLogger(__name__)

# ── Firejail sandboxing ─────────────────────────────────────────────────────
_FIREJAIL: str | None = _shutil.which("firejail")
_SANDBOX_ENABLED: bool = _os.environ.get("SCRIPT_SANDBOX", "1") != "0"
_firejail_warned: bool = False

# run_id -> list[asyncio.Queue]  — one Queue per connected WebSocket client
_ws_queues: dict[str, list[asyncio.Queue]] = {}

# script_id -> asyncio.Task
_loop_tasks: dict[str, asyncio.Task] = {}

# script_id -> datetime of next scheduled run
_next_run: dict[str, datetime] = {}

# script_id -> active subprocess (for force-kill)
_active_procs: dict[str, asyncio.subprocess.Process] = {}


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


def _build_exec_cmd(venv_python: Path, script_dir: Path) -> list[str]:
    """Build the subprocess command, wrapping with firejail when available."""
    global _firejail_warned

    if _SANDBOX_ENABLED and _FIREJAIL:
        return [
            _FIREJAIL,
            "--quiet",
            "--noprofile",
            f"--private={script_dir}",
            "--read-only=.",
            "--read-write=output",
            "--noroot",
            "--",
            str(venv_python.relative_to(script_dir)),
            "-u",
            "script.py",
        ]

    if _SANDBOX_ENABLED and not _FIREJAIL and not _firejail_warned:
        _log.warning(
            "firejail not found — scripts will run UNSANDBOXED. "
            "Install firejail or set SCRIPT_SANDBOX=0 to silence this warning."
        )
        _firejail_warned = True

    return [str(venv_python), "-u", str(script_dir / "script.py")]


async def _execute(
    script_id: str,
    run_id: str,
    script_dir: Path,
    log_path: Path,
) -> None:
    """Run the script subprocess, stream output to log file + WebSocket queues."""
    _ws_queues[run_id] = []
    loop = asyncio.get_running_loop()
    exit_code = -1

    try:
        with open(log_path, "w", buffering=1) as lf:
            def emit(line: str) -> None:
                lf.write(line)
                lf.flush()
                loop.create_task(_broadcast(run_id, line))

            if not venv_exists(script_dir):
                lf.write("=== Setting up virtual environment ===\n")
                await create_venv(script_dir, emit)

            output_dir = script_dir / "output"
            output_dir.mkdir(exist_ok=True)
            run_env = {**_os.environ, "SCRIPT_OUTPUT_DIR": str(output_dir)}
            # Remove backend venv vars so the script uses its own venv
            run_env.pop("VIRTUAL_ENV", None)
            venv_python = script_dir / "venv" / "bin" / "python"
            exec_cmd = _build_exec_cmd(venv_python, script_dir)
            proc = await asyncio.create_subprocess_exec(
                *exec_cmd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(output_dir),
                env=run_env,
            )
            _active_procs[script_id] = proc
            try:
                async for raw in proc.stdout:
                    emit(raw.decode())
                await proc.wait()
            finally:
                _active_procs.pop(script_id, None)
            exit_code = proc.returncode

    except Exception:
        import traceback
        _log.error("_execute failed for %s/%s:\n%s", script_id, run_id, traceback.format_exc())
        # Write traceback to log file so the user sees it
        try:
            with open(log_path, "a") as lf:
                lf.write(f"\n=== INTERNAL ERROR ===\n{traceback.format_exc()}")
        except Exception:
            pass

    # Signal end-of-stream to all WebSocket listeners
    for q in list(_ws_queues.get(run_id, [])):
        await q.put(None)
    _ws_queues.pop(run_id, None)

    if exit_code == 0:
        status = "success"
    elif exit_code is not None and exit_code >= 128:
        status = "error"
    else:
        status = "warning"
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


_DAY_MAP = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def parse_schedule(schedule_str: str) -> tuple[list[int], int, int]:
    """Parse 'schedule:mon,wed,fri@06:00' -> ([0, 2, 4], 6, 0)."""
    body = schedule_str[len("schedule:"):]
    days_part, time_part = body.split("@")
    days = sorted(_DAY_MAP[d.strip()] for d in days_part.split(","))
    h, m = time_part.split(":")
    return days, int(h), int(m)


def _next_scheduled_time(days: list[int], hour: int, minute: int) -> datetime:
    """Return the next datetime matching one of the given weekdays at hour:minute."""
    now = datetime.now()
    target_today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now.weekday() in days and target_today > now:
        return target_today
    for offset in range(1, 8):
        candidate = now + timedelta(days=offset)
        if candidate.weekday() in days:
            return candidate.replace(hour=hour, minute=minute, second=0, microsecond=0)
    raise ValueError("No valid schedule days")


async def _schedule_loop_worker(script_id: str, days: list[int], hour: int, minute: int) -> None:
    """Run script_id at the scheduled day/time until cancelled."""
    try:
        while True:
            next_time = _next_scheduled_time(days, hour, minute)
            _next_run[script_id] = next_time
            wait_seconds = (next_time - datetime.now()).total_seconds()
            if wait_seconds > 0:
                await asyncio.sleep(wait_seconds)
            try:
                await run_script(script_id)
            except Exception as exc:
                import logging
                logging.getLogger(__name__).error(
                    "Scheduled run failed for %s: %s", script_id, exc
                )
            # Wait past the current minute to avoid re-triggering
            await asyncio.sleep(61)
    except asyncio.CancelledError:
        _next_run.pop(script_id, None)
        raise


def parse_monthly(monthly_str: str) -> tuple[int, int, int]:
    """Parse 'monthly:15@06:00' -> (15, 6, 0)."""
    body = monthly_str[len("monthly:"):]
    day_part, time_part = body.split("@")
    h, m = time_part.split(":")
    return int(day_part), int(h), int(m)


def _next_monthly_time(day: int, hour: int, minute: int) -> datetime:
    """Return next datetime matching the given day-of-month at hour:minute."""
    now = datetime.now()
    # Try this month
    try:
        target = now.replace(day=day, hour=hour, minute=minute, second=0, microsecond=0)
        if target > now:
            return target
    except ValueError:
        pass
    # Next month
    if now.month == 12:
        next_month = now.replace(year=now.year + 1, month=1, day=1)
    else:
        next_month = now.replace(month=now.month + 1, day=1)
    try:
        return next_month.replace(day=day, hour=hour, minute=minute, second=0, microsecond=0)
    except ValueError:
        # Day doesn't exist in that month (e.g. 31st of Feb), skip to next
        if next_month.month == 12:
            next_month = next_month.replace(year=next_month.year + 1, month=1, day=1)
        else:
            next_month = next_month.replace(month=next_month.month + 1, day=1)
        return next_month.replace(day=day, hour=hour, minute=minute, second=0, microsecond=0)


async def _monthly_loop_worker(script_id: str, day: int, hour: int, minute: int) -> None:
    """Run script_id on a specific day of each month until cancelled."""
    try:
        while True:
            next_time = _next_monthly_time(day, hour, minute)
            _next_run[script_id] = next_time
            wait = (next_time - datetime.now()).total_seconds()
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                await run_script(script_id)
            except Exception as exc:
                import logging
                logging.getLogger(__name__).error("Monthly run failed for %s: %s", script_id, exc)
            await asyncio.sleep(61)
    except asyncio.CancelledError:
        _next_run.pop(script_id, None)
        raise


def parse_once(once_str: str) -> datetime:
    """Parse 'once:2026-06-15@14:30' -> datetime."""
    body = once_str[len("once:"):]
    date_part, time_part = body.split("@")
    h, m = time_part.split(":")
    y, mo, d = date_part.split("-")
    return datetime(int(y), int(mo), int(d), int(h), int(m))


async def _once_worker(script_id: str, target: datetime) -> None:
    """Run script_id once at a specific date/time, then disable loop."""
    try:
        wait = (target - datetime.now()).total_seconds()
        if wait > 0:
            _next_run[script_id] = target
            await asyncio.sleep(wait)
        try:
            await run_script(script_id)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error("Once run failed for %s: %s", script_id, exc)
    except asyncio.CancelledError:
        _next_run.pop(script_id, None)
        raise
    finally:
        _next_run.pop(script_id, None)
        _loop_tasks.pop(script_id, None)
        async with _db.get_db() as db:
            await db.execute("UPDATE scripts SET loop_enabled=0 WHERE id=?", (script_id,))
            await db.commit()


async def start_loop(script_id: str, interval: str) -> None:
    """Start a looping run task for script_id. No-op if already looping."""
    if is_looping(script_id):
        return
    if interval.startswith("schedule:"):
        days, hour, minute = parse_schedule(interval)
        _loop_tasks[script_id] = asyncio.create_task(
            _schedule_loop_worker(script_id, days, hour, minute)
        )
    elif interval.startswith("monthly:"):
        day, hour, minute = parse_monthly(interval)
        _loop_tasks[script_id] = asyncio.create_task(
            _monthly_loop_worker(script_id, day, hour, minute)
        )
    elif interval.startswith("once:"):
        target = parse_once(interval)
        _loop_tasks[script_id] = asyncio.create_task(
            _once_worker(script_id, target)
        )
    else:
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


async def force_stop(script_id: str) -> None:
    """Kill any running subprocess for script_id and cancel its loop."""
    # Kill the active subprocess (SIGKILL)
    proc = _active_procs.pop(script_id, None)
    if proc and proc.returncode is None:
        try:
            proc.kill()
            await proc.wait()
        except ProcessLookupError:
            pass

    # Cancel loop task
    task = _loop_tasks.pop(script_id, None)
    if task and not task.done():
        task.cancel()
    _next_run.pop(script_id, None)

    # Update DB
    async with _db.get_db() as db:
        await db.execute(
            "UPDATE scripts SET loop_enabled=0 WHERE id=?",
            (script_id,),
        )
        await db.execute(
            "UPDATE runs SET finished_at=datetime('now'), exit_code=-9, status='error' "
            "WHERE script_id=? AND status='running'",
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
