"""PostgreSQL access. Every query in the API goes through connect().

connect() opens a transaction as role disha_api and sets which schools the caller may see
(row-level security, migrations/0003_security.sql):
    connect()                    trusted server work: all schools
    connect(schools=["sch_a"])   a facilitator or teacher: only those schools

The v1 functions below keep /v1/sync working on the legacy tables until phones move to /v2 events.
"""
from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import settings

APP_ROLE = "disha_api"
_pool: ConnectionPool | None = None
_url: str | None = None


def _configure(con: psycopg.Connection) -> None:
    con.execute(f"set role {APP_ROLE}")
    con.commit()


_pool_lock = threading.Lock()


def pool() -> ConnectionPool:
    """The process's one connection pool, made on first use (or at startup, see main.py).

    Sync endpoints run on many threads at once, so making the pool is locked. Without the lock, two first
    requests could each make a pool; the one that lost was never closed, and when it was garbage-collected on
    one of its own worker threads its close() failed with "cannot join current thread" (seen in the 13.3 load test).
    """
    global _pool, _url
    p = _pool
    if p is not None and _url == settings.DATABASE_URL:
        return p
    with _pool_lock:
        if _pool is None or _url != settings.DATABASE_URL:  # the URL changes only in tests
            old = _pool
            _url = settings.DATABASE_URL
            _pool = ConnectionPool(_url, min_size=1, max_size=settings.DB_POOL_MAX, kwargs={"row_factory": dict_row},
                                   configure=_configure, open=True, timeout=settings.DB_POOL_TIMEOUT)
            if old is not None:
                old.close()
        return _pool


def close_pool() -> None:
    global _pool
    with _pool_lock:
        old, _pool = _pool, None
    if old is not None:
        old.close()


@contextmanager
def connect(schools: list[str] | None = None) -> Iterator[psycopg.Connection]:
    scope = "*" if schools is None else ",".join(schools)
    with pool().connection() as con:
        with con.transaction():
            con.execute("select set_config('app.school_ids', %s, true)", (scope,))
            yield con


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------- v1 (legacy) ----------

def upsert_student(con, doc: dict, school_id: str) -> bool:
    """Save into student + encrypted student_private if not already present. Returns True if stored."""
    cur = con.execute(
        "insert into student(id, school_id, facilitator_code, birth_year) values (%s, %s, %s, %s) "
        "on conflict (id) do nothing",
        (doc["id"], school_id, doc.get("facilitator_code"), doc.get("birth_year")),
    )
    if cur.rowcount == 1 and doc.get("name"):
        key = settings.pii_key()
        con.execute(
            "insert into student_private(student_id, name_enc) values (%s, pgp_sym_encrypt(%s::text, %s::text)) "
            "on conflict (student_id) do update set name_enc = coalesce(excluded.name_enc, student_private.name_enc)",
            (doc["id"], doc["name"], key),
        )
    return cur.rowcount == 1


def other_schools_students(con, schools: str | list[str], student_ids: list[str]) -> set[str]:
    """Which of these students belong to a school other than the caller's."""
    if not student_ids:
        return set()
    allowed = [schools] if isinstance(schools, str) else list(schools)
    if not allowed:
        return set(student_ids)
    rows = con.execute("select id from student where id = any(%s) and school_id <> all(%s)",
                       (student_ids, allowed)).fetchall()
    return {r["id"] for r in rows}


def add_action(con, action: dict) -> bool:
    cur = con.execute(
        "insert into legacy_action(id, student_id, kind, payload, by, created_at) values (%s, %s, %s, %s, %s, %s) "
        "on conflict (id) do nothing",
        (action["id"], action["student_id"], action["kind"], json.dumps(action.get("payload", {}), ensure_ascii=False),
         action.get("by"), int(action.get("created_at") or now_ms())),
    )
    return cur.rowcount == 1


def actions_for(con, student_ids: list[str]) -> list[dict]:
    if not student_ids:
        return []
    rows = con.execute("select id, student_id, kind, payload, by, created_at from legacy_action "
                       "where student_id = any(%s) order by created_at, id", (student_ids,)).fetchall()
    return [dict(r) for r in rows]


def cohort(con, facilitator_code: str, school_id: str) -> list[dict]:
    return []
