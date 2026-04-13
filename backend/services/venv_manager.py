import asyncio, sys
from pathlib import Path
from typing import Callable


def venv_exists(script_dir: Path) -> bool:
    return (script_dir / "venv" / "bin" / "python").exists()


async def create_venv(
    script_dir: Path,
    emit: Callable[[str], None],
) -> None:
    """Create isolated venv; pip-install requirements.txt if present. Streams output via emit()."""
    venv_dir = script_dir / "venv"

    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "venv", str(venv_dir),
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
