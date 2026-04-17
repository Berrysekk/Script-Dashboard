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

# Resource limits for sandboxed scripts. These are defence-in-depth against a
# hostile (or buggy) script exhausting CPU, memory, or disk on the host.
# Overridable via env vars for operators that genuinely need more headroom.
_SCRIPT_TIMEOUT_SECONDS = int(_os.environ.get("SCRIPT_TIMEOUT_SECONDS", 3600))     # 1 h
_SCRIPT_MEMORY_BYTES    = int(_os.environ.get("SCRIPT_MEMORY_BYTES", 1_073_741_824))  # 1 GiB
_SCRIPT_MAX_PROCS       = int(_os.environ.get("SCRIPT_MAX_PROCS", 64))
_SCRIPT_MAX_FILESIZE    = int(_os.environ.get("SCRIPT_MAX_FILESIZE", 500 * 1024 * 1024))  # 500 MiB
# Minimum allowed interval-style loop (seconds). Scheduled/monthly/once
# loops are unaffected.
_MIN_LOOP_INTERVAL_SECONDS = int(_os.environ.get("SCRIPT_MIN_LOOP_SECONDS", 30))

# run_id -> list[asyncio.Queue]  — one Queue per connected WebSocket client
_ws_queues: dict[str, list[asyncio.Queue]] = {}

# script_id -> asyncio.Task
_loop_tasks: dict[str, asyncio.Task] = {}

# script_id -> datetime of next scheduled run
_next_run: dict[str, datetime] = {}

# script_id -> active subprocess (for force-kill)
_active_procs: dict[str, asyncio.subprocess.Process] = {}

# script_id -> active _execute task (includes venv setup, not just the script subprocess)
_execute_tasks: dict[str, asyncio.Task] = {}


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
    seconds = value * units[interval[-1]]
    if seconds < _MIN_LOOP_INTERVAL_SECONDS:
        # Guard against a tight loop DoS — an attacker could otherwise set
        # an interval of "1s" and run the script 86,400 times/day.
        raise ValueError(
            f"Interval must be at least {_MIN_LOOP_INTERVAL_SECONDS}s"
        )
    return seconds


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

    task = asyncio.create_task(_execute(script_id, run_id, script_dir, log_file_path))
    _execute_tasks[script_id] = task
    task.add_done_callback(lambda _: _execute_tasks.pop(script_id, None))
    return run_id


async def _broadcast(run_id: str, line: str) -> None:
    """Push a log line to all WebSocket queues watching this run."""
    for q in list(_ws_queues.get(run_id, [])):
        await q.put(line)


def _build_exec_cmd(venv_python: Path, script_dir: Path) -> list[str]:
    """Build the subprocess command, wrapping with firejail when available.

    When firejail is available we also pin per-run CPU-time / memory / process
    / file-size caps so a hostile script can't exhaust the host. When it isn't,
    the caller also applies POSIX rlimits via ``preexec_fn`` (see ``_execute``).
    """
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
            # Resource caps (firejail translates these to rlimits).
            f"--rlimit-as={_SCRIPT_MEMORY_BYTES}",
            f"--rlimit-nproc={_SCRIPT_MAX_PROCS}",
            f"--rlimit-fsize={_SCRIPT_MAX_FILESIZE}",
            f"--timeout={_format_hms(_SCRIPT_TIMEOUT_SECONDS)}",
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


def _format_hms(seconds: int) -> str:
    """Format seconds as ``HH:MM:SS`` for firejail's --timeout flag."""
    h, rem = divmod(max(seconds, 1), 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _apply_rlimits() -> None:
    """preexec_fn used when firejail is unavailable.

    Sets address-space, cpu-time, file-size and process caps on the child.
    Swallows exceptions: this runs in the forked child and any uncaught
    exception would kill the process before exec, producing a confusing
    failure.
    """
    try:
        import resource  # Unix-only — imported lazily for Windows test runs.
        resource.setrlimit(
            resource.RLIMIT_AS,
            (_SCRIPT_MEMORY_BYTES, _SCRIPT_MEMORY_BYTES),
        )
        resource.setrlimit(
            resource.RLIMIT_CPU,
            (_SCRIPT_TIMEOUT_SECONDS, _SCRIPT_TIMEOUT_SECONDS + 5),
        )
        resource.setrlimit(
            resource.RLIMIT_FSIZE,
            (_SCRIPT_MAX_FILESIZE, _SCRIPT_MAX_FILESIZE),
        )
        try:
            resource.setrlimit(
                resource.RLIMIT_NPROC,
                (_SCRIPT_MAX_PROCS, _SCRIPT_MAX_PROCS),
            )
        except (ValueError, OSError):
            # Some kernels don't support RLIMIT_NPROC — best effort.
            pass
    except Exception:  # pragma: no cover — defence in depth only.
        pass


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
        with open(log_path, "a", buffering=1) as lf:
            def emit(line: str) -> None:
                # Seek to end — pip/venv subprocesses write to the same file
                # via a separate FD during create_venv, and our seek position
                # would otherwise point inside their output.
                lf.seek(0, 2)
                lf.write(line)
                lf.flush()
                loop.create_task(_broadcast(run_id, line))

            if not venv_exists(script_dir):
                lf.write("=== Setting up virtual environment ===\n")
                lf.flush()
                await create_venv(script_dir, log_path, emit)

            output_dir = script_dir / "output"
            output_dir.mkdir(exist_ok=True)
            # Materialize user-managed databases into <script_dir>/databases/ so
            # scripts can read them via SCRIPT_DB_DIR.
            from backend.services import databases as databases_service
            async with _db.get_db() as db_conn:
                await databases_service.materialize_for_script(db_conn, script_id, script_dir)
            run_env = {**_os.environ, "SCRIPT_OUTPUT_DIR": str(output_dir)}
            # Inject user-defined variables (set BEFORE SCRIPT_OUTPUT_DIR
            # so a malicious key can never shadow it — we re-set it after).
            async with _db.get_db() as db:
                cur = await db.execute(
                    "SELECT key, value FROM script_variables WHERE script_id = ?",
                    (script_id,),
                )
                _SAFE_SKIP = {"PATH", "HOME", "USER", "SHELL", "LD_PRELOAD",
                              "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
                              "DYLD_LIBRARY_PATH", "PYTHONPATH", "PYTHONHOME",
                              "VIRTUAL_ENV", "SCRIPT_OUTPUT_DIR", "SCRIPT_DB_DIR"}
                for row in await cur.fetchall():
                    k = row["key"]
                    if k.upper() not in _SAFE_SKIP and "\x00" not in row["value"]:
                        run_env[k] = row["value"]
            # Re-assert critical vars so user variables can never shadow them
            run_env["SCRIPT_OUTPUT_DIR"] = str(output_dir)
            run_env["SCRIPT_DB_DIR"] = str(script_dir / "databases")
            # Remove backend venv vars so the script uses its own venv
            run_env.pop("VIRTUAL_ENV", None)
            venv_python = script_dir / "venv" / "bin" / "python"
            exec_cmd = _build_exec_cmd(venv_python, script_dir)
            # Apply POSIX rlimits on every non-firejail spawn. firejail already
            # sets its own rlimits, but stacking them is harmless and keeps the
            # cap enforced even if firejail is misconfigured.
            spawn_kwargs: dict = dict(
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(output_dir),
                env=run_env,
            )
            if _os.name == "posix":
                spawn_kwargs["preexec_fn"] = _apply_rlimits
            proc = await asyncio.create_subprocess_exec(*exec_cmd, **spawn_kwargs)
            _active_procs[script_id] = proc
            try:
                async def _stream() -> None:
                    async for raw in proc.stdout:
                        emit(raw.decode())
                    await proc.wait()

                try:
                    # Wall-clock ceiling enforced by the parent process. This
                    # is belt-and-braces alongside firejail's --timeout and
                    # RLIMIT_CPU (which only counts CPU time, not sleep).
                    await asyncio.wait_for(_stream(), timeout=_SCRIPT_TIMEOUT_SECONDS + 30)
                except asyncio.TimeoutError:
                    emit(f"\n=== Killed after {_SCRIPT_TIMEOUT_SECONDS}s wall-clock timeout ===\n")
                    try:
                        proc.kill()
                    except ProcessLookupError:
                        pass
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

    # Cancel the _execute task (covers venv setup + script subprocess)
    exec_task = _execute_tasks.pop(script_id, None)
    if exec_task and not exec_task.done():
        exec_task.cancel()

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
