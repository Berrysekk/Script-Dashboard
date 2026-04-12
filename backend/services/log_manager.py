from pathlib import Path
from datetime import date, datetime, timedelta, timezone
import backend.db as _db


def log_path_for_run(script_id: str, run_id: str, run_date: date) -> Path:
    """Return the log file path for a run, creating parent dirs."""
    log_dir = _db.LOGS_DIR / script_id / run_date.isoformat()
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / f"{run_id}.log"


async def prune_old_runs(retention_days: int = 30) -> None:
    """Delete run DB records and log files older than retention_days."""
    cutoff_str = (datetime.now(timezone.utc) - timedelta(days=retention_days)).strftime("%Y-%m-%d %H:%M:%S")
    async with _db.get_db() as db:
        cur = await db.execute(
            "SELECT id, log_path FROM runs WHERE started_at < ?",
            (cutoff_str,),
        )
        rows = await cur.fetchall()
        for row in rows:
            log_file = _db.LOGS_DIR / row["log_path"]
            if log_file.exists():
                log_file.unlink()
        ids = [r["id"] for r in rows]
        if ids:
            placeholders = ",".join("?" * len(ids))
            await db.execute(f"DELETE FROM runs WHERE id IN ({placeholders})", tuple(ids))
            await db.commit()
