"""Sign-in for everyone: phone number or email plus a one-time code.

    POST /v2/auth/otp      {login}                       -> sends a 6-digit code (or shows it, in demo mode)
    POST /v2/auth/verify   {login, code, device_id, ...} -> signs in (or signs up) and returns a device token
    GET  /v2/auth/me                                     -> who this phone is signed in as
    POST /v2/auth/logout                                 -> the token stops working

Rules (also in packages/engine/src/registry.ts as rule.otp):
- A code is 6 digits, lives 10 minutes, allows 5 tries, and works once. Only its hash is stored.
- Asking for codes is rate limited per address, and a new code for the same login replaces the old ones.
- The phone number or email is never stored in readable form: accounts are found by an HMAC of it.
- New students and teachers need their school's class or teacher code; the role comes from that code,
  never from what the phone asks for. Donors and employers get no school, so they never see student rows.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import auth, db, settings
from ..auth import Device
from ..ratelimit import limit
from ..schemas import new_ulid

router = APIRouter(prefix="/v2/auth", tags=["sign-in"])

OTP_MINUTES = 10
OTP_TRIES = 5
ROLES = ("student", "teacher", "funder", "employer")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def normalise(login: str) -> tuple[str, str]:
    """('phone', '9876543210') or ('email', 'a@b.in'). Indian mobile numbers: 10 digits starting 6-9."""
    s = login.strip()
    if "@" in s:
        if not EMAIL.match(s):
            raise HTTPException(400, "That email does not look right")
        return "email", s.lower()
    digits = re.sub(r"\D", "", s)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not re.fullmatch(r"[6-9]\d{9}", digits):
        raise HTTPException(400, "Enter a 10-digit mobile number or an email")
    return "phone", digits


def login_hash(value: str) -> str:
    return hmac.new(settings.AUTH_SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()


def mask(kind: str, value: str) -> str:
    if kind == "phone":
        return f"{value[:2]}•••••{value[-3:]}"
    user, _, domain = value.partition("@")
    return f"{user[0]}•••@{domain}"


def _code_hash(lh: str, code: str) -> str:
    return hashlib.sha256(f"{lh}:{code}".encode()).hexdigest()


def _send_email(to: str, code: str) -> bool:
    if not (settings.SMTP_HOST and settings.SMTP_USER):
        return False
    msg = EmailMessage()
    msg["Subject"] = f"Disha sign-in code: {code}"
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = to
    msg.set_content(f"Your Disha code is {code}. It works for {OTP_MINUTES} minutes. Never share it with anyone.")
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as s:
            s.starttls()
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException):
        return False


class OtpIn(BaseModel):
    login: str = Field(min_length=3, max_length=120, description="10-digit mobile number or email")


@router.post("/otp", summary="Send a one-time sign-in code to a phone number or email",
             dependencies=[Depends(limit("otp", per_minute=5))])
def request_otp(body: OtpIn):
    kind, value = normalise(body.login)
    lh = login_hash(value)
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = datetime.now(tz=timezone.utc)
    with db.connect() as con:
        # one live code per login: asking again kills the older ones
        con.execute("update login_otp set used_at = %s where login_hash = %s and used_at is null", (now, lh))
        con.execute("insert into login_otp(login_hash, code_hash, expires_at) values (%s, %s, %s)",
                    (lh, _code_hash(lh, code), now + timedelta(minutes=OTP_MINUTES)))
        known = con.execute("select role, name from account where login_hash = %s and disabled_at is null", (lh,)).fetchone()
    sent = kind == "email" and _send_email(value, code)
    out = {"sent_to": mask(kind, value), "kind": kind, "new_account": known is None,
           "delivery": "email" if sent else "demo", "minutes": OTP_MINUTES}
    if not sent:
        if not settings.OTP_DEMO:
            raise HTTPException(503, "Sign-in codes cannot be sent right now")
        # Demo mode (no SMS or email provider configured): the code is shown on screen.
        out["demo_code"] = code
    return out


class VerifyIn(BaseModel):
    login: str = Field(min_length=3, max_length=120)
    code: str = Field(min_length=6, max_length=6)
    device_id: str = Field(min_length=4, max_length=100)
    # only for a new account:
    role: str | None = Field(None, description="student | teacher | funder | employer")
    name: str | None = Field(None, max_length=80)
    org: str | None = Field(None, max_length=120)
    join_code: str | None = Field(None, max_length=64, description="Class code (students) or teacher code (teachers)")
    privacy_ok: bool = False


def _check_code(con, lh: str, code: str) -> str | None:
    """None when the code is right (and uses it up); otherwise the reason it was refused.
    Returns instead of raising so the wrong-try count is committed."""
    row = con.execute("select id, code_hash, attempts, expires_at from login_otp where login_hash = %s and used_at is null "
                      "order by created_at desc limit 1", (lh,)).fetchone()
    now = datetime.now(tz=timezone.utc)
    if not row or row["expires_at"] < now or row["attempts"] >= OTP_TRIES:
        return "This code has expired; ask for a new one"
    if not hmac.compare_digest(row["code_hash"], _code_hash(lh, code)):
        con.execute("update login_otp set attempts = attempts + 1 where id = %s", (row["id"],))
        left = OTP_TRIES - row["attempts"] - 1
        return f"Wrong code. {left} tries left" if left > 0 else "Too many wrong tries; ask for a new code"
    con.execute("update login_otp set used_at = %s where id = %s", (now, row["id"]))
    return None


def _public(acc: dict) -> dict:
    return {"id": acc["id"], "role": acc["role"], "name": acc["name"], "org": acc.get("org"), "login": acc["login_masked"],
            "school_id": acc.get("school_id"), "class_code": acc.get("class_code"), "student_id": acc.get("student_id")}


@router.post("/verify", summary="Check the code; sign in, or create the account on first sign-in",
             dependencies=[Depends(limit("otp_verify", per_minute=20))])
def verify(body: VerifyIn):
    kind, value = normalise(body.login)
    lh = login_hash(value)
    # The code check commits on its own, so a wrong guess is always counted.
    with db.connect() as con:
        problem = _check_code(con, lh, body.code)
    if problem:
        raise HTTPException(400, problem)
    with db.connect() as con:
        acc = con.execute("select * from account where login_hash = %s", (lh,)).fetchone()
        if acc and acc["disabled_at"] is not None:
            raise HTTPException(403, "This account has been switched off")
        if not acc:
            acc = _create_account(con, body, kind, value, lh)
        old = con.execute("select account_id, revoked_at from device where id = %s", (body.device_id,)).fetchone()
        if old and old["revoked_at"] is not None:
            raise HTTPException(403, "This phone has been switched off; ask the school")
        token = auth.new_token()
        con.execute("insert into device(id, school_id, role, token_hash, account_id) values (%s, %s, %s, %s, %s) "
                    "on conflict (id) do update set school_id = excluded.school_id, role = excluded.role, "
                    "token_hash = excluded.token_hash, account_id = excluded.account_id",
                    (body.device_id, acc["school_id"], acc["role"], auth.hash_token(token), acc["id"]))
        con.execute("update account set last_login_at = now() where id = %s", (acc["id"],))
    return {"token": token, "account": _public(acc)}


def _create_account(con, body: VerifyIn, kind: str, value: str, lh: str) -> dict:
    if body.role not in ROLES:
        raise HTTPException(400, "Choose who you are: student, teacher, donor or employer")
    if not (body.name or "").strip():
        raise HTTPException(400, "Tell us your name")
    if not body.privacy_ok:
        raise HTTPException(400, "Please read and accept how Disha uses your details")
    school_id = class_code = None
    if body.role in ("student", "teacher"):
        code = (body.join_code or "").strip().upper()
        jc = con.execute("select school_id, role, class_code from join_code where code = %s and revoked_at is null",
                         (code,)).fetchone() if code else None
        if not jc:
            raise HTTPException(400, "Enter your school's class code" if body.role == "student" else "Enter your teacher code")
        # The role comes from the code: a class code can never make a teacher account.
        if jc["role"] != body.role:
            raise HTTPException(400, "That is not a teacher code" if body.role == "teacher" else "That is a teacher code; choose Teacher")
        school_id, class_code = jc["school_id"], jc["class_code"]
    acc = {"id": f"acc_{new_ulid()}", "role": body.role, "login_hash": lh, "login_kind": kind,
           "login_masked": mask(kind, value), "name": body.name.strip(), "org": (body.org or "").strip() or None,
           "school_id": school_id, "class_code": class_code, "student_id": None}
    con.execute("insert into account(id, role, login_hash, login_kind, login_masked, name, org, school_id, class_code, privacy_ok_at) "
                "values (%(id)s, %(role)s, %(login_hash)s, %(login_kind)s, %(login_masked)s, %(name)s, %(org)s, %(school_id)s, "
                "%(class_code)s, now())", acc)
    return acc


def _account(dev: Device) -> dict:
    if not dev.account_id:
        raise HTTPException(401, "Sign in first")
    with db.connect() as con:
        acc = con.execute("select * from account where id = %s and disabled_at is null", (dev.account_id,)).fetchone()
    if not acc:
        raise HTTPException(401, "Sign in first")
    return acc


@router.get("/me", summary="The account this phone is signed in as")
def me(dev: Device = Depends(auth.device)):
    return _public(_account(dev))


class LinkIn(BaseModel):
    student_id: str = Field(min_length=4, max_length=100)


@router.post("/me/student", summary="A student account remembers its own profile (so another phone can find it)")
def link_student(body: LinkIn, dev: Device = Depends(auth.role_in("student"))):
    acc = _account(dev)
    with db.connect() as con:
        con.execute("update account set student_id = %s where id = %s", (body.student_id, acc["id"]))
    return {"ok": True}


@router.post("/logout", summary="Sign out: this phone's token stops working")
def logout(dev: Device = Depends(auth.device)):
    with db.connect() as con:
        con.execute("update device set token_hash = %s, account_id = null where id = %s",
                    (auth.hash_token(auth.new_token()), dev.id))
    return {"ok": True}


@router.delete("/me", summary="Delete my account (a student's learning record is deleted separately, with a guardian)")
def delete_me(dev: Device = Depends(auth.device)):
    acc = _account(dev)
    with db.connect() as con:
        con.execute("delete from account where id = %s", (acc["id"],))
    return {"deleted": True}
