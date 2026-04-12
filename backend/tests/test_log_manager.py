import pytest
from pathlib import Path
from datetime import date, timedelta
from backend.services.log_manager import log_path_for_run, prune_old_runs
import backend.db as db_module

def test_log_path_creates_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(db_module, "LOGS_DIR", tmp_path / "logs")
    path = log_path_for_run("script-abc", "run-123", date(2026, 4, 12))
    assert str(path).endswith("script-abc/2026-04-12/run-123.log")
    assert path.parent.exists()

@pytest.mark.asyncio
async def test_prune_deletes_old_runs(tmp_path, monkeypatch):
    monkeypatch.setattr(db_module, "DB_PATH",     tmp_path / "script-database")
    monkeypatch.setattr(db_module, "DATA_DIR",    tmp_path)
    monkeypatch.setattr(db_module, "SCRIPTS_DIR", tmp_path / "scripts")
    monkeypatch.setattr(db_module, "LOGS_DIR",    tmp_path / "logs")
    await db_module.init_db()

    old_date = (date.today() - timedelta(days=35)).isoformat()
    log_dir  = tmp_path / "logs" / "s1" / old_date
    log_dir.mkdir(parents=True)
    log_file = log_dir / "r1.log"
    log_file.write_text("old log")

    async with db_module.get_db() as db:
        await db.execute("INSERT INTO scripts (id,name,filename) VALUES ('s1','S','s.py')")
        await db.execute(
            "INSERT INTO runs (id,script_id,started_at,log_path,status) VALUES (?,?,?,?,'success')",
            ("r1", "s1", f"{old_date} 00:00:00", f"s1/{old_date}/r1.log"),
        )
        await db.commit()

    await prune_old_runs(retention_days=30)
    assert not log_file.exists()

    async with db_module.get_db() as db:
        cur   = await db.execute("SELECT COUNT(*) FROM runs WHERE id='r1'")
        count = (await cur.fetchone())[0]
    assert count == 0
