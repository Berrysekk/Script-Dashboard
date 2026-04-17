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
