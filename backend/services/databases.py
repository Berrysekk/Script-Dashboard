"""Databases feature: schema + CRUD + materialization into script sandbox."""
from __future__ import annotations

import json
import re
import uuid
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
