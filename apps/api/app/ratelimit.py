"""A small in-memory rate limit (sliding window per client), so nobody can guess class codes or burn the AI budget.

Used as a FastAPI dependency:  Depends(limit("devices", per_minute=10))
One process only (enough for the pilot on one Render instance). With several instances, move the counters to Postgres
or Redis. Limits can be raised with RATE_LIMIT_SCALE (e.g. 10 for load tests); 0 switches limiting off.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def _client(request: Request) -> str:
    # Behind Render's proxy the first X-Forwarded-For entry is the phone's address.
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")


def limit(bucket: str, per_minute: int):
    def check(request: Request) -> None:
        scale = float(os.getenv("RATE_LIMIT_SCALE", "1"))
        if scale <= 0:
            return
        allowed = max(1, int(per_minute * scale))
        key = f"{bucket}:{_client(request)}"
        now = time.monotonic()
        with _lock:
            q = _hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= allowed:
                raise HTTPException(429, "Too many requests. Wait a minute and try again.",
                                    headers={"Retry-After": str(int(60 - (now - q[0])) + 1)})
            q.append(now)
    return check


def reset() -> None:
    """For tests."""
    with _lock:
        _hits.clear()
