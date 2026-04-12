import aiosqlite
from pathlib import Path
from contextlib import asynccontextmanager

DATA_DIR = Path("/data")
DB_PATH = DATA_DIR / "script-database"
SCRIPTS_DIR = DATA_DIR / "scripts"
LOGS_DIR = DATA_DIR / "logs"


async def init_db() -> None:
  DATA_DIR.mkdir(parents=True, exist_ok=True)
  SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
  LOGS_DIR.mkdir(parents=True, exist_ok=True)

  async with aiosqlite.connect(DB_PATH) as db:
    await db.execute("""
      CREATE TABLE IF NOT EXISTS scripts (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        filename     TEXT NOT NULL,
        description  TEXT,
        loop_enabled BOOLEAN DEFAULT 0,
        loop_interval TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    """)
    await db.execute("""
      CREATE TABLE IF NOT EXISTS runs (
        id          TEXT PRIMARY KEY,
        script_id   TEXT NOT NULL,
        started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        finished_at DATETIME,
        exit_code   INTEGER,
        log_path    TEXT NOT NULL,
        status      TEXT DEFAULT 'running',
        FOREIGN KEY (script_id) REFERENCES scripts(id)
      )
    """)
    await db.commit()


@asynccontextmanager
async def get_db():
  async with aiosqlite.connect(DB_PATH) as db:
    db.row_factory = aiosqlite.Row
    yield db
