"""Databases feature: schema + CRUD + materialization into script sandbox."""
from __future__ import annotations

import json
import re
import uuid
from datetime import date as _date, datetime as _datetime
from pathlib import Path

MAX_SLUG_LEN = 64
MAX_ROWS_PER_DB = 1000
MAX_COLS_PER_DB = 50
MAX_ROW_BYTES = 10 * 1024

_SLUG_RE = re.compile(r"^[a-z_][a-z0-9_]*$")

VALID_COLUMN_TYPES = frozenset({
    "text", "long_text", "number", "boolean", "secret",
    "url", "email", "date", "datetime", "select", "json",
})


def validate_slug(slug: str) -> str:
    """Return the slug or raise ValueError."""
    if not isinstance(slug, str) or not slug:
        raise ValueError("Slug cannot be empty")
    if len(slug) > MAX_SLUG_LEN:
        raise ValueError(f"Slug exceeds {MAX_SLUG_LEN} characters")
    if not _SLUG_RE.match(slug):
        raise ValueError(
            "Slug must match [a-z_][a-z0-9_]* (lowercase letters, digits, underscore)"
        )
    return slug


def validate_key(key: str) -> str:
    """Column keys share the slug grammar."""
    return validate_slug(key)


def derive_slug(name: str) -> str:
    """Best-effort slug from a human name; callers can override."""
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9_]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        s = "db"
    if s[0].isdigit():
        s = f"_{s}"
    return s[:MAX_SLUG_LEN]


def coerce_cell(col_type: str, value, config: dict | None):
    """Coerce a value to its column type, or raise ValueError.

    Returns None for empty strings/None input (type is always nullable).
    For `select`, enforces membership in `config["options"]`.
    For `json`, accepts either a JSON string or an already-parsed structure.
    """
    if value is None:
        return None
    if isinstance(value, str) and value == "" and col_type not in ("text", "long_text"):
        return None

    if col_type in ("text", "long_text", "url", "email", "secret"):
        return str(value)

    if col_type == "number":
        if isinstance(value, bool):
            raise ValueError("must be a number")
        try:
            if isinstance(value, str):
                v = value.strip()
                if "." in v or "e" in v or "E" in v:
                    return float(v)
                return int(v)
            return value if isinstance(value, (int, float)) else float(value)
        except (TypeError, ValueError):
            raise ValueError("must be a number")

    if col_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            v = value.strip().lower()
            if v in ("true", "1", "yes", "y", "on"):
                return True
            if v in ("false", "0", "no", "n", "off"):
                return False
        raise ValueError("must be boolean")

    if col_type == "date":
        if isinstance(value, _date) and not isinstance(value, _datetime):
            return value.isoformat()
        try:
            return _date.fromisoformat(str(value)).isoformat()
        except ValueError:
            raise ValueError("must be a date (YYYY-MM-DD)")

    if col_type == "datetime":
        if isinstance(value, _datetime):
            return value.isoformat()
        try:
            return _datetime.fromisoformat(str(value)).isoformat()
        except ValueError:
            raise ValueError("must be a datetime (ISO 8601)")

    if col_type == "select":
        options = (config or {}).get("options") or []
        s = str(value)
        if s not in options:
            raise ValueError(f"must be one of: {', '.join(options)}")
        return s

    if col_type == "json":
        if isinstance(value, (dict, list, int, float, bool)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                raise ValueError("must be valid JSON")
        raise ValueError("must be valid JSON")

    raise ValueError(f"unknown column type: {col_type}")


class SlugConflict(ValueError):
    def __init__(self, slug: str, suggestion: str):
        super().__init__(f"Slug already taken: {slug}")
        self.slug = slug
        self.suggestion = suggestion


async def _suggest_free_slug(db, base: str) -> str:
    for i in range(2, 1000):
        candidate = f"{base}_{i}"
        cur = await db.execute("SELECT 1 FROM databases WHERE slug = ?", (candidate,))
        if not await cur.fetchone():
            return candidate
    raise ValueError("Could not find a free slug suggestion")


async def create_database(db, name: str, slug: str | None, description: str | None) -> str:
    if slug is None or slug == "":
        slug = derive_slug(name)
    validate_slug(slug)
    cur = await db.execute("SELECT 1 FROM databases WHERE slug = ?", (slug,))
    if await cur.fetchone():
        raise SlugConflict(slug, await _suggest_free_slug(db, slug))
    db_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO databases (id, name, slug, description) VALUES (?, ?, ?, ?)",
        (db_id, name, slug, description),
    )
    await db.commit()
    return db_id


async def list_databases(db) -> list[dict]:
    cur = await db.execute(
        "SELECT id, name, slug, description, created_at FROM databases ORDER BY created_at ASC"
    )
    rows = await cur.fetchall()
    result: list[dict] = []
    for r in rows:
        cur2 = await db.execute(
            "SELECT COUNT(*) AS n FROM database_columns WHERE database_id = ?", (r["id"],)
        )
        col_n = (await cur2.fetchone())["n"]
        cur3 = await db.execute(
            "SELECT COUNT(*) AS n FROM database_rows WHERE database_id = ?", (r["id"],)
        )
        row_n = (await cur3.fetchone())["n"]
        result.append({
            "id": r["id"], "name": r["name"], "slug": r["slug"],
            "description": r["description"], "created_at": r["created_at"],
            "column_count": col_n, "row_count": row_n,
        })
    return result


async def get_database(db, db_id: str) -> dict | None:
    cur = await db.execute(
        "SELECT id, name, slug, description, created_at FROM databases WHERE id = ?",
        (db_id,),
    )
    row = await cur.fetchone()
    if not row:
        return None
    cur = await db.execute(
        "SELECT id, name, key, type, config, position FROM database_columns "
        "WHERE database_id = ? ORDER BY position ASC, name ASC",
        (db_id,),
    )
    columns = [
        {
            "id": c["id"], "name": c["name"], "key": c["key"], "type": c["type"],
            "config": json.loads(c["config"]) if c["config"] else None,
            "position": c["position"],
        }
        for c in await cur.fetchall()
    ]
    cur = await db.execute(
        "SELECT id, values_json, position, created_at FROM database_rows "
        "WHERE database_id = ? ORDER BY position ASC, created_at ASC",
        (db_id,),
    )
    rows_out: list[dict] = []
    for r in await cur.fetchall():
        try:
            values = json.loads(r["values_json"])
        except (json.JSONDecodeError, TypeError):
            values = {}
        rows_out.append({
            "id": r["id"], "values": values,
            "position": r["position"], "created_at": r["created_at"],
        })
    return {
        "id": row["id"], "name": row["name"], "slug": row["slug"],
        "description": row["description"], "created_at": row["created_at"],
        "columns": columns, "rows": rows_out,
    }


async def update_database(
    db, db_id: str, name: str | None, slug: str | None, description: str | None
) -> None:
    cur = await db.execute("SELECT 1 FROM databases WHERE id = ?", (db_id,))
    if not await cur.fetchone():
        raise ValueError("Database not found")
    if slug is not None:
        validate_slug(slug)
        cur = await db.execute(
            "SELECT 1 FROM databases WHERE slug = ? AND id <> ?", (slug, db_id)
        )
        if await cur.fetchone():
            raise SlugConflict(slug, await _suggest_free_slug(db, slug))
    if name is not None:
        await db.execute("UPDATE databases SET name = ? WHERE id = ?", (name, db_id))
    if slug is not None:
        await db.execute("UPDATE databases SET slug = ? WHERE id = ?", (slug, db_id))
    if description is not None:
        await db.execute(
            "UPDATE databases SET description = ? WHERE id = ?", (description, db_id)
        )
    await db.commit()


async def delete_database(db, db_id: str) -> None:
    cur = await db.execute("SELECT 1 FROM databases WHERE id = ?", (db_id,))
    if not await cur.fetchone():
        raise ValueError("Database not found")
    await db.execute("DELETE FROM databases WHERE id = ?", (db_id,))
    await db.commit()
