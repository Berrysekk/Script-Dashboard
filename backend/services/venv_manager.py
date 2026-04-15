import asyncio, os, shutil, subprocess, sys
from pathlib import Path
from typing import Callable

# Stable CPython versions that have binary wheels for most packages on PyPI.
# Tried in order; first match wins. sys.executable is the final fallback.
_PREFERRED_VERSIONS = ("python3.13", "python3.12", "python3.11", "python3.10")


def _script_python() -> str:
    """Return the Python interpreter to use for script venvs.

    Priority:
      1. SCRIPT_PYTHON env var  — explicit override (useful in Docker)
      2. First stable CPython found on PATH (3.13 -> 3.10)
      3. sys.executable          — backend's own interpreter
    """
    if override := os.environ.get("SCRIPT_PYTHON"):
        return override
    for name in _PREFERRED_VERSIONS:
        if path := shutil.which(name):
            return path
    return sys.executable


def venv_exists(script_dir: Path) -> bool:
    return (script_dir / "venv" / "bin" / "python").exists()


def _run_to_log(args: list[str], log_path: Path, env: dict | None = None) -> int:
    """Run subprocess with stdout/stderr redirected straight to log_path (append).

    Uses direct file descriptors — no PIPE, no executor threading, no asyncio
    child-watcher. This avoids every known way the venv setup has hung under
    uvicorn --reload on macOS.
    """
    with open(log_path, "ab", buffering=0) as lf:
        proc = subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=lf,
            stderr=subprocess.STDOUT,
            env=env,
        )
        return proc.wait()


async def create_venv(
    script_dir: Path,
    log_path: Path,
    emit: Callable[[str], None],
) -> None:
    """Create isolated venv; pip-install requirements.txt if present.

    Subprocess output is written directly to ``log_path`` by the child process
    (no PIPE). ``emit`` is only used for our own status lines so the WebSocket
    stream still gets progress updates.
    """
    venv_dir = script_dir / "venv"
    python = _script_python()
    emit(f"=== Using {python} ===\n")
    loop = asyncio.get_running_loop()

    rc = await loop.run_in_executor(
        None, _run_to_log, [python, "-m", "venv", str(venv_dir)], log_path, None
    )
    if rc != 0:
        raise RuntimeError(f"venv creation failed (exit {rc})")

    req_file = script_dir / "requirements.txt"
    if not req_file.exists():
        emit("=== No requirements.txt — add packages via the Requirements editor ===\n")
        return

    emit("=== Installing requirements ===\n")
    pip = venv_dir / "bin" / "pip"
    pip_env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    rc = await loop.run_in_executor(
        None, _run_to_log,
        [str(pip), "install",
         "--disable-pip-version-check", "--no-input", "--timeout", "30",
         "-r", str(req_file)],
        log_path,
        pip_env,
    )
    if rc != 0:
        emit(f"=== pip install failed (exit {rc}) — script will likely fail ===\n")
    else:
        emit("=== Requirements installed successfully ===\n")
