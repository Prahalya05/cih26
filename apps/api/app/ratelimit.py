"""Postgres-backed sliding-window rate limit so counters work across multiple API instances.

Used as a FastAPI dependency:  Depends(limit("devices", per_minute=10))
Limits can be raised with RATE_LIMIT_SCALE (e.g. 10 for load tests); 0 switches limiting off.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from . import db


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
        with db.connect() as con:
            con.execute("delete from rate_limit where key = %s and hit_at < now() - interval '60 seconds'", (key,))
            row = con.execute(
                "select count(*) as n, min(hit_at) as oldest from rate_limit where key = %s",
                (key,),
            ).fetchone()
            if row["n"] >= allowed:
                oldest = row["oldest"] or datetime.now(tz=timezone.utc)
                retry_after = max(1, int(60 - (datetime.now(tz=timezone.utc) - oldest).total_seconds()) + 1)
                raise HTTPException(
                    429,
                    "Too many requests. Wait a minute and try again.",
                    headers={"Retry-After": str(retry_after)},
                )
            con.execute("insert into rate_limit(key, hit_at) values (%s, now())", (key,))
    return check


def reset() -> None:
    """For tests."""
    try:
        with db.connect() as con:
            con.execute("delete from rate_limit")
    except Exception:
        pass
