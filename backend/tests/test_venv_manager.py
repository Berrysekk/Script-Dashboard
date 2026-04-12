import pytest
from backend.services.venv_manager import venv_exists, create_venv

@pytest.mark.asyncio
async def test_create_venv(tmp_path):
    script_dir = tmp_path / "myscript"
    script_dir.mkdir()
    lines = []
    async def collect(line: str):
        lines.append(line)
    await create_venv(script_dir, collect)
    assert (script_dir / "venv" / "bin" / "python").exists()

@pytest.mark.asyncio
async def test_venv_exists_false_before_create(tmp_path):
    script_dir = tmp_path / "s"
    script_dir.mkdir()
    assert not venv_exists(script_dir)
