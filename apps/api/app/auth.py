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
    school_id: str
    role: str  # student | teacher

    @property
    def is_teacher(self) -> bool:
        return self.role == "teacher"

    @property
    def schools(self) -> list[str]:
        return [self.school_id]


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
        row = con.execute("select id, school_id, role from device where token_hash = %s and revoked_at is null",
                          (hash_token(token.strip()),)).fetchone()
    if not row:
        raise _unauthorised("This phone's registration is not valid; enter the class code again")
    return Device(**row)


def teacher(dev: Device = Depends(device)) -> Device:
    """FastAPI dependency: a phone registered with a teacher code."""
    if not dev.is_teacher:
        raise HTTPException(403, "Only a teacher's phone can do this")
    return dev
