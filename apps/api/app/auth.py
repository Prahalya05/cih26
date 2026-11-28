"""Who is calling the API.

A phone registers once (POST /v2/devices) with a join code and keeps the token it gets back. Every endpoint that
reads or writes student data takes `Authorization: Bearer <token>` and works only inside that phone's school:
the request's database connection is opened with db.connect(device.schools), so row-level security hides every
other school's students (migrations/0003_security.sql).

Open without a token: /health, /v1/kb, /v1/match, /v1/eligibility (no student data is stored) and the buyer's
/v2/confirm/{token} pages (the one-time link is the proof).

Idle sign-ins: a phone signed in to an account (phone number or email + one-time code) that has not reached the server
for settings.SESSION_IDLE_DAYS stops working and must sign in again with a new code. Its token is replaced with a dead
value (not revoked, so the same phone can still sign in). Phones registered with a class code only are not affected.
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException

from . import db, settings


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


def _unauthorised(msg: str | dict) -> HTTPException:
    return HTTPException(401, msg, headers={"WWW-Authenticate": "Bearer"})


def device(authorization: str | None = Header(None, description="Bearer <device token from POST /v2/devices>")) -> Device:
    """FastAPI dependency: the registered phone making this request."""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorised("This phone is not registered; enter the class code first")
    extra: tuple[str, ...] = ()
    with db.connect() as con:
        row = con.execute("select id, school_id, role, account_id, (account_id is not null and last_seen_at < now() - "
                          "make_interval(days => %s)) as idle from device where token_hash = %s and revoked_at is null",
                          (settings.SESSION_IDLE_DAYS, hash_token(token.strip()))).fetchone()
        if not row:
            raise _unauthorised("This phone's registration is not valid; enter the class code again")
        if row["idle"]:
            # Too long away: this token dies; a new one-time code is needed (POST /v2/auth/otp, then /verify).
            # Not raised here: raising inside connect() would roll this update back.
            con.execute("update device set token_hash = %s where id = %s", ("expired:" + secrets.token_hex(16), row["id"]))
        else:
            con.execute("update device set last_seen_at = now() where id = %s and last_seen_at < now() - interval '1 hour'",
                        (row["id"],))
            if row["account_id"] and row["role"] == "teacher":
                rooms = con.execute("select distinct school_id from classroom where teacher_account = %s",
                                    (row["account_id"],)).fetchall()
                extra = tuple(r["school_id"] for r in rooms if r["school_id"] and r["school_id"] != row["school_id"])
    if row["idle"]:
        raise _unauthorised({"code": "session_idle", "days": settings.SESSION_IDLE_DAYS,
                             "message": f"You have not used Disha for {settings.SESSION_IDLE_DAYS} days. "
                                        "Sign in again with a new code."})
    return Device(id=row["id"], school_id=row["school_id"], role=row["role"], account_id=row["account_id"],
                  extra_schools=extra)


def school_member(dev: Device = Depends(device)) -> Device:
    """FastAPI dependency: a student or teacher phone, i.e. one that belongs to a school and may sync student data."""
    if not dev.schools or dev.role not in ("student", "teacher"):
        raise HTTPException(403, "Only a student's or teacher's phone can do this")
    return dev


def forbidden_student_ids(con, dev: Device, student_ids: set[str]) -> set[str]:
    """Student ids this caller may NOT read/write (enforces per-student isolation for signed-in student accounts)."""
    if dev.role != "student" or not dev.account_id or not student_ids:
        return set()
    mine = linked_students(con, dev.account_id)
    taken = {r["student_id"] for r in con.execute(
        "select student_id from account_student where student_id = any(%s) and account_id <> %s",
        (sorted(student_ids), dev.account_id)).fetchall()}
    # Profiles not linked to anyone yet may be used (and get linked) only while she has room for more.
    new = sorted(set(student_ids) - mine - taken)
    room = max(0, settings.STUDENT_PROFILES_MAX - len(mine))
    return taken | set(new[room:])


def linked_students(con, account_id: str) -> set[str]:
    """The student profiles a student account holds (migration 0016)."""
    return {r["student_id"] for r in con.execute(
        "select student_id from account_student where account_id = %s", (account_id,)).fetchall()}


def link_student(con, account_id: str, student_id: str) -> str:
    """Links a profile to a student account. Returns "ok", "taken" (another account has it) or "full"."""
    owner = con.execute("select account_id from account_student where student_id = %s", (student_id,)).fetchone()
    if owner:
        return "ok" if owner["account_id"] == account_id else "taken"
    if len(linked_students(con, account_id)) >= settings.STUDENT_PROFILES_MAX:
        return "full"
    con.execute("insert into account_student(account_id, student_id) values (%s, %s) on conflict do nothing",
                (account_id, student_id))
    # the first profile also stays in account.student_id, for phones with the older app
    con.execute("update account set student_id = %s where id = %s and student_id is null", (student_id, account_id))
    return "ok"


def check_student_access(con, dev: Device, student_id: str) -> None:
    """Refuses a signed-in student trying to access another student's record inside the same school/class."""
    if student_id in forbidden_student_ids(con, dev, {student_id}):
        raise HTTPException(403, "You can only access your own student record")


def maybe_link_student(con, dev: Device, student_id: str) -> None:
    """Links a signed-in student account's synced profile, while it has room for more (STUDENT_PROFILES_MAX)."""
    if dev.role != "student" or not dev.account_id:
        return
    link_student(con, dev.account_id, student_id)


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
