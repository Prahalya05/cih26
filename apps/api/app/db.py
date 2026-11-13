"""PostgreSQL access. Every query in the API goes through connect().

connect() opens a transaction as role disha_api and sets which schools the caller may see
(row-level security, migrations/0003_security.sql):
    connect()                    trusted server work: all schools
    connect(schools=["sch_a"])   a facilitator or teacher: only those schools

The v1 functions below keep /v1/sync working on the legacy tables until phones move to /v2 events.
"""
from __future__ import annotations

import json
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


def pool() -> ConnectionPool:
    global _pool, _url
    if _pool is None or _url != settings.DATABASE_URL:
        if _pool is not None:
            _pool.close()
        _url = settings.DATABASE_URL
        _pool = ConnectionPool(_url, min_size=1, max_size=10, kwargs={"row_factory": dict_row},
                               configure=_configure, open=True)
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


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

def upsert_student(con, doc: dict) -> bool:
    """Save if newer than what we have. Returns True if stored."""
    updated = int(doc.get("updated_at") or now_ms())
    cur = con.execute(
        "insert into legacy_student_doc(id, facilitator_code, doc, updated_at) values (%s, %s, %s, %s) "
        "on conflict (id) do update set facilitator_code = excluded.facilitator_code, doc = excluded.doc, "
        "updated_at = excluded.updated_at where legacy_student_doc.updated_at < excluded.updated_at",
        (doc["id"], doc.get("facilitator_code"), json.dumps(doc, ensure_ascii=False), updated),
    )
    return cur.rowcount == 1


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


def cohort(con, facilitator_code: str) -> list[dict]:
    rows = con.execute("select doc from legacy_student_doc where facilitator_code = %s order by updated_at desc",
                       (facilitator_code,)).fetchall()
    return [r["doc"] for r in rows]
