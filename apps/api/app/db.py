"""SQLite storage for synced students, teacher endorsements, recommendations and feedback.

Students are stored as JSON documents; the phone is the source of truth for the profile and the
server keeps the latest copy (last write wins, by updated_at).
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.getenv("DISHA_DB", Path(__file__).resolve().parents[1] / "disha.sqlite3"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  facilitator_code TEXT,
  doc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS students_fac ON students(facilitator_code);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- endorse | recommend | feedback | checkin
  payload TEXT NOT NULL,
  by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS actions_student ON actions(student_id);
"""


@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        con.executescript(SCHEMA)
        yield con
        con.commit()
    finally:
        con.close()


def now_ms() -> int:
    return int(time.time() * 1000)


def upsert_student(con, doc: dict) -> bool:
    """Save if newer than what we have. Returns True if stored."""
    row = con.execute("SELECT updated_at FROM students WHERE id = ?", (doc["id"],)).fetchone()
    updated = int(doc.get("updated_at") or now_ms())
    if row and row["updated_at"] >= updated:
        return False
    con.execute(
        "INSERT INTO students(id, facilitator_code, doc, updated_at) VALUES (?,?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET facilitator_code=excluded.facilitator_code, doc=excluded.doc, "
        "updated_at=excluded.updated_at",
        (doc["id"], doc.get("facilitator_code"), json.dumps(doc, ensure_ascii=False), updated),
    )
    return True


def add_action(con, action: dict) -> bool:
    cur = con.execute(
        "INSERT OR IGNORE INTO actions(id, student_id, kind, payload, by, created_at) VALUES (?,?,?,?,?,?)",
        (action["id"], action["student_id"], action["kind"], json.dumps(action.get("payload", {}), ensure_ascii=False),
         action.get("by"), int(action.get("created_at") or now_ms())),
    )
    return cur.rowcount == 1


def actions_for(con, student_ids: list[str]) -> list[dict]:
    if not student_ids:
        return []
    q = ",".join("?" * len(student_ids))
    rows = con.execute(f"SELECT * FROM actions WHERE student_id IN ({q}) ORDER BY created_at", student_ids).fetchall()
    return [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]


def cohort(con, facilitator_code: str) -> list[dict]:
    rows = con.execute("SELECT doc FROM students WHERE facilitator_code = ? ORDER BY updated_at DESC",
                       (facilitator_code,)).fetchall()
    return [json.loads(r["doc"]) for r in rows]
