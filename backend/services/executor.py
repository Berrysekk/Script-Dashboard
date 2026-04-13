import asyncio
import uuid
from datetime import datetime, date
from pathlib import Path
import backend.db as _db
from backend.services.venv_manager import venv_exists, create_venv
from backend.services.log_manager import log_path_for_run

# run_id -> list[asyncio.Queue]  — one Queue per connected WebSocket client
_ws_queues: dict[str, list[asyncio.Queue]] = {}

# script_id -> asyncio.Task
_loop_tasks: dict[str, asyncio.Task] = {}

# script_id -> datetime of next scheduled run
_next_run: dict[str, datetime] = {}


def parse_interval(interval: str) -> int:
    """
    Convert a user-supplied interval string to an integer number of seconds.

    Supported suffixes:
        s  — seconds   e.g. "30s"  → 30
        m  — minutes   e.g. "10m"  → 600
        h  — hours     e.g. "6h"   → 21600

    Raises:
        ValueError("Invalid interval: <interval>") for any unrecognised format,
        including empty strings, negative numbers, non-integer prefixes, or
        unknown suffix characters.

    Rules:
        - Leading/trailing whitespace is stripped
        - The numeric part must be a positive integer (zero and negatives are rejected)
        - A bare number with no suffix is invalid
        - Decimal values (e.g. "1.5h") are invalid
    """
    interval = interval.strip()
    units = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    if not interval or interval[-1] not in units:
        raise ValueError(f"Invalid interval: {interval}")
    try:
        value = int(interval[:-1])
    except ValueError:
        raise ValueError(f"Invalid interval: {interval}")
    if value <= 0:
        raise ValueError(f"Invalid interval: {interval}")
    return value * units[interval[-1]]
