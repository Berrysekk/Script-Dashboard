"""Password hashing, session management, and master-password helpers.

Pure helpers — no FastAPI imports — so this module is trivially unit-testable
and reusable from the CLI.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import backend.db as _db

# ── Password hashing ────────────────────────────────────────────────────────

_PBKDF2_ITERS = 200_000
_PBKDF2_ALGO  = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    """PBKDF2-HMAC-SHA256, serialized as `pbkdf2_sha256$iters$salt_hex$hash_hex`."""
    salt   = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERS)
    return f"{_PBKDF2_ALGO}${_PBKDF2_ITERS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time compare against a `hash_password` output."""
    try:
        algo, iters_s, salt_hex, hash_hex = stored.split("$")
    except ValueError:
        return False
    if algo != _PBKDF2_ALGO:
        return False
    try:
        iters = int(iters_s)
        salt  = bytes.fromhex(salt_hex)
        want  = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    got = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return hmac.compare_digest(got, want)


# A throwaway hash used for timing-equalization when a login user doesn't exist.
_DUMMY_HASH = hash_password("dummy-for-timing")


def dummy_verify() -> None:
    """Run a verify against a pre-computed dummy hash to flatten login timing."""
    verify_password("dummy", _DUMMY_HASH)


# ── Sessions ────────────────────────────────────────────────────────────────

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_session(db, user_id: str, max_age_days: int = 7) -> str:
    """Create a session row for user_id and return the raw token (cookie value)."""
    token      = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=max_age_days)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    await db.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (token_hash, user_id, expires_at),
    )
    await db.commit()
    return token


async def get_session_user(db, token: str):
    """Look up the user for a session token. Returns an aiosqlite.Row or None."""
    if not token:
        return None
    token_hash = _hash_token(token)
    cur = await db.execute(
        """
        SELECT u.id, u.username, u.role, u.created_at, s.expires_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > datetime('now')
        """,
        (token_hash,),
    )
    return await cur.fetchone()


async def delete_session(db, token: str) -> None:
    await db.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))
    await db.commit()


async def delete_user_sessions(db, user_id: str) -> None:
    await db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    await db.commit()


async def purge_expired_sessions(db) -> None:
    await db.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    await db.commit()


# ── User CRUD ───────────────────────────────────────────────────────────────

async def create_user(db, username: str, password: str, role: str = "user") -> str:
    if role not in ("admin", "user"):
        raise ValueError("role must be 'admin' or 'user'")
    user_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
        (user_id, username, hash_password(password), role),
    )
    await db.commit()
    return user_id


async def get_user_by_username(db, username: str):
    cur = await db.execute("SELECT * FROM users WHERE username = ?", (username,))
    return await cur.fetchone()


async def get_user_by_id(db, user_id: str):
    cur = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    return await cur.fetchone()


async def list_users(db):
    cur = await db.execute("SELECT id, username, role, created_at FROM users ORDER BY created_at")
    return await cur.fetchall()


async def delete_user(db, user_id: str) -> None:
    await db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await db.commit()


async def set_password(db, user_id: str, new_password: str) -> None:
    await db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (hash_password(new_password), user_id),
    )
    await db.commit()


# ── Master password (recovery secret) ───────────────────────────────────────
#
# Stored hashed in a standalone file — deliberately outside the SQLite DB so
# that restoring a DB backup can't silently re-introduce a stale master, and so
# no HTTP code path ever touches it. Rotation is CLI-only (backend/cli.py).

def master_hash_path() -> Path:
    """Looked up lazily so tests can monkey-patch ``_db.DATA_DIR``."""
    return _db.DATA_DIR / "master_password.hash"


def read_master_hash() -> Optional[str]:
    path = master_hash_path()
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8").strip() or None


def write_master_hash(password: str) -> None:
    path = master_hash_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = hash_password(password).encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)


def verify_master_password(password: str) -> bool:
    stored = read_master_hash()
    return bool(stored) and verify_password(password, stored)


def bootstrap_master_password() -> None:
    """Ensure a master password hash exists on disk.

    - If the hash file already exists, do nothing.
    - Else, if ``MASTER_PASSWORD`` env var is set, hash and write it.
    - Else, generate a random one and print it once to stderr.
    """
    if master_hash_path().exists():
        return
    env_pw = os.environ.get("MASTER_PASSWORD")
    if env_pw:
        write_master_hash(env_pw)
        print("Master password bootstrapped from MASTER_PASSWORD env var.", file=sys.stderr)
        return
    generated = secrets.token_urlsafe(16)
    write_master_hash(generated)
    print(f"Generated master password: {generated}", file=sys.stderr)
    print(
        "Record this — it is the only way to recover user passwords through the "
        "web UI. Rotate via `python -m backend.cli set-master-password`.",
        file=sys.stderr,
    )


async def bootstrap_admin(db) -> None:
    """Create the first admin account if the users table is empty.

    Backfills ``scripts.owner_id`` for any pre-existing rows so uploads from
    before auth was introduced remain visible after upgrade.
    """
    cur = await db.execute("SELECT COUNT(*) FROM users")
    count = (await cur.fetchone())[0]
    if count > 0:
        return

    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        password = secrets.token_urlsafe(16)
        print(f"Generated admin password: {password}", file=sys.stderr)
        print(f"Log in as '{username}' with the password above.", file=sys.stderr)
    else:
        print(f"Admin user '{username}' bootstrapped from ADMIN_PASSWORD.", file=sys.stderr)

    user_id = await create_user(db, username, password, role="admin")
    await db.execute(
        "UPDATE scripts SET owner_id = ? WHERE owner_id IS NULL",
        (user_id,),
    )
    await db.commit()
