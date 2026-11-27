"""Who is calling the API.

A phone registers once (POST /v2/devices) with a join code and keeps the token it gets back. Every endpoint that
reads or writes student data takes `Authorization: Bearer <token>` and works only inside that phone's school:
the request's database connection is opened with db.connect(device.schools), so row-level security hides every
other school's students (migrations/0003_security.sql).

Open without a token: /health, /v1/kb, /v1/match, /v1/eligibility (no student data is stored) and the buyer's
/v2/confirm/{token} pages (the one-time link is the proof).
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException

from . import db


@dataclass(frozen=True)
class Device:
    id: str
    school_id: str | None
    role: str  # student | teacher | funder | employer
    account_id: str | None = None
    extra_schools: tuple[str, ...] = ()

    @property
    def is_teacher(self) -> bool:
        return self.role == "teacher"

    @property
    def schools(self) -> list[str]:
        # Donors and employers have no school, so row-level security shows them no student rows.
        # Teachers may have both a physical school and separate online classroom schools.
        out: list[str] = []
        for s in (self.school_id, *self.extra_schools):
            if s and s not in out:
                out.append(s)
        return out


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _unauthorised(msg: str) -> HTTPException:
    return HTTPException(401, msg, headers={"WWW-Authenticate": "Bearer"})


def device(authorization: str | None = Header(None, description="Bearer <device token from POST /v2/devices>")) -> Device:
    """FastAPI dependency: the registered phone making this request."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorised("This phone is not registered; enter the class code first")
    with db.connect() as con:
        row = con.execute("select id, school_id, role, account_id from device where token_hash = %s and revoked_at is null",
                          (hash_token(token.strip()),)).fetchone()
        if not row:
            raise _unauthorised("This phone's registration is not valid; enter the class code again")
        extra: tuple[str, ...] = ()
        if row["account_id"] and row["role"] == "teacher":
            rooms = con.execute("select distinct school_id from classroom where teacher_account = %s",
                                (row["account_id"],)).fetchall()
            extra = tuple(r["school_id"] for r in rooms if r["school_id"] and r["school_id"] != row["school_id"])
    return Device(**row, extra_schools=extra)


def school_member(dev: Device = Depends(device)) -> Device:
    """FastAPI dependency: a student or teacher phone, i.e. one that belongs to a school and may sync student data."""
    if not dev.schools or dev.role not in ("student", "teacher"):
        raise HTTPException(403, "Only a student's or teacher's phone can do this")
    return dev


def forbidden_student_ids(con, dev: Device, student_ids: set[str]) -> set[str]:
    """Student ids this caller may NOT read/write (enforces per-student isolation for signed-in student accounts)."""
    if dev.role != "student" or not dev.account_id or not student_ids:
        return set()
    acc = con.execute("select student_id from account where id = %s", (dev.account_id,)).fetchone()
    if acc and acc["student_id"]:
        return {sid for sid in student_ids if sid != acc["student_id"]}
    taken = con.execute("select student_id from account where student_id = any(%s) and id <> %s",
                        (sorted(student_ids), dev.account_id)).fetchall()
    return {r["student_id"] for r in taken if r["student_id"]}


def check_student_access(con, dev: Device, student_id: str) -> None:
    """Refuses a signed-in student trying to access another student's record inside the same school/class."""
    if student_id in forbidden_student_ids(con, dev, {student_id}):
        raise HTTPException(403, "You can only access your own student record")


def maybe_link_student(con, dev: Device, student_id: str) -> None:
    """Links a signed-in student account's first synced profile if not linked yet."""
    if dev.role != "student" or not dev.account_id:
        return
    taken = con.execute("select 1 from account where student_id = %s and id <> %s",
                        (student_id, dev.account_id)).fetchone()
    if not taken:
        con.execute("update account set student_id = %s where id = %s and student_id is null",
                    (student_id, dev.account_id))


def teacher(dev: Device = Depends(device)) -> Device:
    """FastAPI dependency: a phone registered with a teacher code."""
    if not dev.is_teacher:
        raise HTTPException(403, "Only a teacher's phone can do this")
    return dev


def role_in(*roles: str):
    """FastAPI dependency factory: a signed-in phone whose role is one of `roles`."""
    def check(dev: Device = Depends(device)) -> Device:
        if dev.role not in roles:
            raise HTTPException(403, f"Only {' or '.join(roles)} accounts can do this")
        return dev
    return check
