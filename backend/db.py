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
    db.row_factory = aiosqlite.Row
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
    await db.execute("""
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    """)
    await db.execute("""
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash  TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at  DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    """)

    # Add scripts.owner_id if it's missing (migration for pre-auth installs)
    cur = await db.execute("PRAGMA table_info(scripts)")
    cols = {row[1] for row in await cur.fetchall()}
    if "owner_id" not in cols:
      await db.execute("ALTER TABLE scripts ADD COLUMN owner_id TEXT")

    await db.commit()

    # Bootstrap first admin + master-password file. Imported lazily to avoid a
    # circular import (services.auth imports this module for DATA_DIR).
    from backend.services import auth as auth_service
    await auth_service.bootstrap_admin(db)
    auth_service.bootstrap_master_password()


@asynccontextmanager
async def get_db():
  async with aiosqlite.connect(DB_PATH) as db:
    db.row_factory = aiosqlite.Row
    yield db
