"""Databases feature: schema + CRUD + materialization into script sandbox."""
from __future__ import annotations

import json
import logging
import os
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


async def create_column(
    db, db_id: str, name: str, key: str, col_type: str, config: dict | None
) -> str:
    cur = await db.execute("SELECT 1 FROM databases WHERE id = ?", (db_id,))
    if not await cur.fetchone():
        raise ValueError("Database not found")
    validate_key(key)
    if col_type not in VALID_COLUMN_TYPES:
        raise ValueError(f"Unknown column type: {col_type}")
    if col_type == "select":
        opts = (config or {}).get("options")
        if not isinstance(opts, list) or not opts or not all(isinstance(o, str) for o in opts):
            raise ValueError("select columns require config.options (non-empty list of strings)")
    cur = await db.execute(
        "SELECT COUNT(*) AS n FROM database_columns WHERE database_id = ?", (db_id,)
    )
    if (await cur.fetchone())["n"] >= MAX_COLS_PER_DB:
        raise ValueError(f"Maximum of {MAX_COLS_PER_DB} columns per database")
    cur = await db.execute(
        "SELECT 1 FROM database_columns WHERE database_id = ? AND key = ?", (db_id, key)
    )
    if await cur.fetchone():
        raise ValueError(f"Column key already exists: {key}")
    cur = await db.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM database_columns WHERE database_id = ?",
        (db_id,),
    )
    position = (await cur.fetchone())["p"]
    col_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO database_columns (id, database_id, name, key, type, config, position) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (col_id, db_id, name, key, col_type, json.dumps(config) if config else None, position),
    )
    await db.commit()
    return col_id


async def update_column(
    db, db_id: str, col_id: str,
    name: str | None, col_type: str | None, config: dict | None,
) -> dict:
    cur = await db.execute(
        "SELECT id, key, type, config FROM database_columns WHERE id = ? AND database_id = ?",
        (col_id, db_id),
    )
    row = await cur.fetchone()
    if not row:
        raise ValueError("Column not found")
    current_type = row["type"]
    current_key = row["key"]
    new_type = col_type if col_type is not None else current_type
    new_config = config if config is not None else (
        json.loads(row["config"]) if row["config"] else None
    )
    if new_type not in VALID_COLUMN_TYPES:
        raise ValueError(f"Unknown column type: {new_type}")

    if new_type == "select":
        new_opts = set((new_config or {}).get("options") or [])
        cur = await db.execute(
            "SELECT id, values_json FROM database_rows WHERE database_id = ?", (db_id,)
        )
        affected: list[str] = []
        for r in await cur.fetchall():
            try:
                vs = json.loads(r["values_json"])
            except (json.JSONDecodeError, TypeError):
                continue
            v = vs.get(current_key)
            if v is not None and str(v) not in new_opts:
                affected.append(r["id"])
        if affected:
            raise OptionsInUse(affected)

    coerced = 0
    nulled = 0
    if col_type is not None and col_type != current_type:
        cur = await db.execute(
            "SELECT id, values_json FROM database_rows WHERE database_id = ?", (db_id,)
        )
        rs = await cur.fetchall()
        for r in rs:
            try:
                vs = json.loads(r["values_json"])
            except (json.JSONDecodeError, TypeError):
                vs = {}
            if current_key not in vs:
                continue
            try:
                new_val = coerce_cell(new_type, vs[current_key], new_config)
                vs[current_key] = new_val
                coerced += 1
            except ValueError:
                vs[current_key] = None
                nulled += 1
            await db.execute(
                "UPDATE database_rows SET values_json = ? WHERE id = ?",
                (json.dumps(vs), r["id"]),
            )

    if name is not None:
        await db.execute(
            "UPDATE database_columns SET name = ? WHERE id = ?", (name, col_id)
        )
    if col_type is not None:
        await db.execute(
            "UPDATE database_columns SET type = ? WHERE id = ?", (col_type, col_id)
        )
    if config is not None:
        await db.execute(
            "UPDATE database_columns SET config = ? WHERE id = ?",
            (json.dumps(config) if config else None, col_id),
        )
    await db.commit()
    return {"coerced": coerced, "nulled": nulled}


class OptionsInUse(ValueError):
    def __init__(self, affected_row_ids: list[str]):
        super().__init__("Select options in use by existing rows")
        self.affected_row_ids = affected_row_ids


async def delete_column(db, db_id: str, col_id: str) -> None:
    cur = await db.execute(
        "SELECT key FROM database_columns WHERE id = ? AND database_id = ?",
        (col_id, db_id),
    )
    row = await cur.fetchone()
    if not row:
        raise ValueError("Column not found")
    key_to_drop = row["key"]
    cur = await db.execute(
        "SELECT id, values_json FROM database_rows WHERE database_id = ?", (db_id,)
    )
    for r in await cur.fetchall():
        try:
            vs = json.loads(r["values_json"])
        except (json.JSONDecodeError, TypeError):
            vs = {}
        if key_to_drop in vs:
            vs.pop(key_to_drop, None)
            await db.execute(
                "UPDATE database_rows SET values_json = ? WHERE id = ?",
                (json.dumps(vs), r["id"]),
            )
    await db.execute("DELETE FROM database_columns WHERE id = ?", (col_id,))
    await db.commit()


async def reorder_columns(db, db_id: str, column_ids: list[str]) -> None:
    cur = await db.execute(
        "SELECT id FROM database_columns WHERE database_id = ?", (db_id,)
    )
    existing = {r["id"] for r in await cur.fetchall()}
    if set(column_ids) != existing:
        raise ValueError("column_ids must exactly match existing columns")
    for idx, cid in enumerate(column_ids):
        await db.execute(
            "UPDATE database_columns SET position = ? WHERE id = ? AND database_id = ?",
            (idx, cid, db_id),
        )
    await db.commit()


class RowValidationError(ValueError):
    def __init__(self, errors: dict[str, str]):
        super().__init__("Row validation failed")
        self.errors = errors


async def _load_columns_by_key(db, db_id: str) -> dict[str, dict]:
    cur = await db.execute(
        "SELECT name, key, type, config FROM database_columns WHERE database_id = ?",
        (db_id,),
    )
    out: dict[str, dict] = {}
    for r in await cur.fetchall():
        out[r["key"]] = {
            "name": r["name"],
            "type": r["type"],
            "config": json.loads(r["config"]) if r["config"] else None,
        }
    return out


def _coerce_values(values: dict, columns: dict[str, dict]) -> dict:
    """Coerce an input {key: value} map against the schema. Unknown keys dropped."""
    errors: dict[str, str] = {}
    out: dict = {}
    for key, raw in values.items():
        if key not in columns:
            continue
        col = columns[key]
        try:
            out[key] = coerce_cell(col["type"], raw, col["config"])
        except ValueError as e:
            errors[key] = str(e)
    if errors:
        raise RowValidationError(errors)
    return out


async def create_row(db, db_id: str, values: dict) -> str:
    cur = await db.execute("SELECT 1 FROM databases WHERE id = ?", (db_id,))
    if not await cur.fetchone():
        raise ValueError("Database not found")
    cur = await db.execute(
        "SELECT COUNT(*) AS n FROM database_rows WHERE database_id = ?", (db_id,)
    )
    if (await cur.fetchone())["n"] >= MAX_ROWS_PER_DB:
        raise ValueError(f"Maximum of {MAX_ROWS_PER_DB} rows per database")
    columns = await _load_columns_by_key(db, db_id)
    clean = _coerce_values(values, columns)
    serialized = json.dumps(clean)
    if len(serialized.encode("utf-8")) > MAX_ROW_BYTES:
        raise ValueError(f"Row exceeds {MAX_ROW_BYTES} bytes")
    cur = await db.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM database_rows WHERE database_id = ?",
        (db_id,),
    )
    position = (await cur.fetchone())["p"]
    row_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO database_rows (id, database_id, values_json, position) "
        "VALUES (?, ?, ?, ?)",
        (row_id, db_id, serialized, position),
    )
    await db.commit()
    return row_id


async def update_row(db, db_id: str, row_id: str, values: dict) -> None:
    cur = await db.execute(
        "SELECT values_json FROM database_rows WHERE id = ? AND database_id = ?",
        (row_id, db_id),
    )
    row = await cur.fetchone()
    if not row:
        raise ValueError("Row not found")
    try:
        current = json.loads(row["values_json"])
    except (json.JSONDecodeError, TypeError):
        current = {}
    columns = await _load_columns_by_key(db, db_id)
    patch = _coerce_values(values, columns)
    current.update(patch)
    serialized = json.dumps(current)
    if len(serialized.encode("utf-8")) > MAX_ROW_BYTES:
        raise ValueError(f"Row exceeds {MAX_ROW_BYTES} bytes")
    await db.execute(
        "UPDATE database_rows SET values_json = ? WHERE id = ?", (serialized, row_id)
    )
    await db.commit()


async def delete_row(db, db_id: str, row_id: str) -> None:
    cur = await db.execute(
        "SELECT 1 FROM database_rows WHERE id = ? AND database_id = ?", (row_id, db_id)
    )
    if not await cur.fetchone():
        raise ValueError("Row not found")
    await db.execute("DELETE FROM database_rows WHERE id = ?", (row_id,))
    await db.commit()


async def reorder_rows(db, db_id: str, row_ids: list[str]) -> None:
    cur = await db.execute(
        "SELECT id FROM database_rows WHERE database_id = ?", (db_id,)
    )
    existing = {r["id"] for r in await cur.fetchall()}
    if set(row_ids) != existing:
        raise ValueError("row_ids must exactly match existing rows")
    for idx, rid in enumerate(row_ids):
        await db.execute(
            "UPDATE database_rows SET position = ? WHERE id = ? AND database_id = ?",
            (idx, rid, db_id),
        )
    await db.commit()


_log = logging.getLogger(__name__)


async def _owner_role(db, script_id: str) -> str | None:
    cur = await db.execute(
        "SELECT u.role FROM scripts s LEFT JOIN users u ON s.owner_id = u.id WHERE s.id = ?",
        (script_id,),
    )
    row = await cur.fetchone()
    return row["role"] if row and row["role"] else None


async def _accessible_database_ids(db, role: str) -> list[str] | None:
    """Admin role -> None (sentinel for 'all'). Otherwise list from role_databases."""
    if role == "admin":
        return None
    cur = await db.execute(
        "SELECT database_id FROM role_databases WHERE role_name = ?", (role,)
    )
    return [r["database_id"] for r in await cur.fetchall()]


async def materialize_for_script(db, script_id: str, script_dir: Path) -> None:
    """Write one JSON file per accessible database into `<script_dir>/databases/`."""
    target_dir = Path(script_dir) / "databases"
    if target_dir.exists():
        for entry in target_dir.iterdir():
            try:
                entry.unlink()
            except OSError as e:
                _log.warning("Failed to remove stale materialized file %s: %s", entry, e)
    target_dir.mkdir(parents=True, exist_ok=True)

    role = await _owner_role(db, script_id)
    if role is None:
        return
    accessible = await _accessible_database_ids(db, role)
    if accessible is None:
        cur = await db.execute("SELECT id, slug FROM databases")
    elif not accessible:
        return
    else:
        placeholders = ",".join("?" for _ in accessible)
        cur = await db.execute(
            f"SELECT id, slug FROM databases WHERE id IN ({placeholders})",
            tuple(accessible),
        )
    for meta in await cur.fetchall():
        cur2 = await db.execute(
            "SELECT values_json FROM database_rows WHERE database_id = ? "
            "ORDER BY position ASC, created_at ASC",
            (meta["id"],),
        )
        rows_out: list[dict] = []
        for r in await cur2.fetchall():
            try:
                rows_out.append(json.loads(r["values_json"]))
            except (json.JSONDecodeError, TypeError):
                _log.warning("Skipping corrupt values_json in database %s", meta["id"])
                continue
        try:
            # 0o600 — secrets are plaintext for the script; keep the file
            # unreadable to other host users even if the data volume is looser.
            path = target_dir / f"{meta['slug']}.json"
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            try:
                os.write(fd, json.dumps(rows_out, indent=2).encode("utf-8"))
            finally:
                os.close(fd)
        except OSError as e:
            _log.warning(
                "Failed to materialize database %s for script %s: %s",
                meta["slug"], script_id, e,
            )
