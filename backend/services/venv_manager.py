import asyncio, os, shutil, sys
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


async def create_venv(
    script_dir: Path,
    emit: Callable[[str], None],
) -> None:
    """Create isolated venv; pip-install requirements.txt if present. Streams output via emit()."""
    venv_dir = script_dir / "venv"
    python = _script_python()
    emit(f"=== Using {python} ===\n")

    proc = await asyncio.create_subprocess_exec(
        python, "-m", "venv", str(venv_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    async for line in proc.stdout:
        emit(line.decode())
    rc = await proc.wait()
    if rc != 0:
        raise RuntimeError(f"venv creation failed with exit code {rc}")

    req_file = script_dir / "requirements.txt"
    if req_file.exists():
        emit("=== Installing requirements ===\n")
        pip  = venv_dir / "bin" / "pip"
        proc = await asyncio.create_subprocess_exec(
            str(pip), "install", "-r", str(req_file),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for line in proc.stdout:
            emit(line.decode())
        rc = await proc.wait()
        if rc != 0:
            emit(f"=== pip install failed (exit {rc}) — script will likely fail ===\n")
        else:
            emit("=== Requirements installed successfully ===\n")
    else:
        emit("=== No requirements.txt found — add packages via the Requirements editor ===\n")
