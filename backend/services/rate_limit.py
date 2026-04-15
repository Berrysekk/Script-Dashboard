"""In-process sliding-window rate limiter.

Deliberately kept dependency-free — this app runs as a single uvicorn
worker and has no external Redis, so a module-level dict is sufficient.
If the deployment ever scales horizontally this needs to move to a shared
store (Redis, DB row-with-expiry, etc.).

All buckets are keyed by an opaque string (typically
``"<action>:<client-ip>"``); callers decide the scope. Each bucket stores a
deque of timestamps and expires anything older than ``window_seconds``
before checking the limit. A 429 is raised if the bucket is full.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque, Dict

from fastapi import HTTPException

_BUCKETS: Dict[str, Deque[float]] = {}
_LOCK = threading.Lock()


def enforce_rate_limit(key: str, *, limit: int, window_seconds: float) -> None:
    """Raise ``HTTPException(429)`` if ``key`` has exceeded ``limit`` hits in
    ``window_seconds``. Otherwise record the hit and return.

    Thread-safe — callers may invoke this from multiple asyncio workers.
    """
    now = time.monotonic()
    cutoff = now - window_seconds
    with _LOCK:
        bucket = _BUCKETS.get(key)
        if bucket is None:
            bucket = deque()
            _BUCKETS[key] = bucket
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            # Compute retry-after hint from the oldest hit still in the window.
            retry_after = max(1, int(window_seconds - (now - bucket[0])))
            raise HTTPException(
                status_code=429,
                detail="Too many requests",
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)


def reset_rate_limits() -> None:
    """Clear all buckets. Intended for test teardown."""
    with _LOCK:
        _BUCKETS.clear()
