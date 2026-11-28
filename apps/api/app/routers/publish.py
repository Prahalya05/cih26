"""Opt-in profile publishing with strict allow-list, minor protection, guardian OTP, and unguessable public slugs.

Rules (rule.publish, guard.publish):
  - Off by default; requires consent scope 'publish_profile'.
  - Under 18 (or unknown age): NEVER 'public'; 'verified_partners' at most, and only with guardian consent.
  - Snapshot built strictly on the server from an allow-list (extra='forbid' rejects client-injected fields).
  - Public view (GET /v2/public/profile/{slug}): 128-bit slug, X-Robots-Tag: noindex, Cache-Control: no-store,
    rate-limited, aggregate view counts only, no slug logged.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field

from .. import auth, db, kb, settings
from ..auth import Device
from ..ratelimit import limit
from ..services import tracing

router = APIRouter(prefix="/v2", tags=["publish"])

Visibility = Literal["private", "school", "verified_partners", "public"]
RIASEC_LABELS = {"R": "Hands-on", "I": "Curious", "A": "Creative", "S": "Helping", "E": "Leading", "C": "Organised"}
OTP_TTL_MIN = 10
OTP_MAX_TRIES = 5


class PublishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    student_id: str = Field(min_length=1, max_length=64)
    visibility: Visibility
    avatar: str | None = Field(None, max_length=8)
    interest_tags: list[str] = Field(default_factory=list, max_length=6)


class PublishedSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    handle: str
    avatar: str
    district: str | None = None
    age_band: Literal["under_18", "18_plus", "unknown"]
    verified_skills: list[dict]
    interest_tags: list[str]
    school: str | None = None
    contact_note: str = "Contact through school"


class GuardianOtpIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    student_id: str = Field(min_length=1, max_length=64)
    phone: str = Field(min_length=6, max_length=32)


class GuardianOtpVerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    student_id: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=4, max_length=12)


def _pseudonym(student_id: str) -> str:
    return "S-" + hmac.new(settings.AUTH_SECRET.encode("utf-8"), student_id.encode("utf-8"), hashlib.sha256).hexdigest()[:6].upper()


def _is_minor(birth_year: int | None, now_year: int | None = None) -> tuple[bool, Literal["under_18", "18_plus", "unknown"]]:
    if birth_year is None:
        return True, "unknown"
    yr = now_year or datetime.now(tz=timezone.utc).year
    if yr - birth_year >= 19:
        return False, "18_plus"
    return True, "under_18"


def build_snapshot(student: dict, school_name: str | None, events: list[dict],
                   avatar: str | None, interest_tags: list[str], is_minor: bool, age_band: Literal["under_18", "18_plus", "unknown"]) -> PublishedSnapshot:
    now_ms = datetime.now(tz=timezone.utc).timestamp() * 1000
    prof = tracing.fold_events(events, {"now": now_ms, "items": kb.items(), "rubrics": kb.rubrics()})
    subs = kb.graph().get("subskills", {})
    skills_kb = kb.skills()
    verified_skills = []
    for uid, u in sorted(prof["units"].items(), key=lambda kv: (-kv[1]["level"], -kv[1]["confidence"], kv[0])):
        if not u["performance"] or u["level"] < 2:
            continue
        meta = subs.get(uid) or skills_kb.get(uid) or {}
        verified_skills.append({
            "id": uid,
            "name": (meta.get("name") or {}).get("en", uid),
            "level": u["level"],
            "strong": bool(u["strong"]),
        })
    clean_tags = [RIASEC_LABELS.get(t, t) for t in interest_tags if t in RIASEC_LABELS or t in RIASEC_LABELS.values()][:6]
    return PublishedSnapshot(
        handle=_pseudonym(student["id"]),
        avatar=(avatar or "🧑")[:8],
        district=student.get("district"),
        age_band=age_band,
        verified_skills=verified_skills[:10],
        interest_tags=clean_tags,
        school=None if is_minor else school_name,
        contact_note="Contact through school",
    )


def _check_publish_rules(con, student: dict, visibility: Visibility, is_minor: bool) -> None:
    if visibility == "private":
        return
    consent = con.execute(
        "select scopes, method from consent where student_id = %s and revoked_at is null order by granted_at desc limit 1",
        (student["id"],)).fetchone()
    if not consent or "publish_profile" not in (consent["scopes"] or []):
        raise HTTPException(403, {"rule": "guard.publish", "message": "publish_profile consent is required"})
    if is_minor:
        if visibility == "public":
            raise HTTPException(403, {"rule": "rule.publish", "message": "Minors cannot publish publicly; verified_partners is the maximum"})
        if visibility == "verified_partners" and consent["method"] not in ("paper_form", "otp"):
            raise HTTPException(403, {"rule": "rule.publish", "message": "Guardian consent is required for minors"})


def _load_student_and_events(con, student_id: str) -> tuple[dict, str | None, list[dict]]:
    from .v2 import _row_to_event
    st = con.execute("select id, school_id, district, birth_year from student where id = %s", (student_id,)).fetchone()
    if not st:
        raise HTTPException(404, "Sync this student first")
    school = con.execute("select name from school where id = %s", (st["school_id"],)).fetchone() if st["school_id"] else None
    rows = con.execute("select * from evidence_event where student_id = %s order by created_at, id", (student_id,)).fetchall()
    return dict(st), (school["name"] if school else None), [_row_to_event(r) for r in rows]


@router.post("/profile/publish/preview", summary="Build an exact allow-listed preview of what others will see")
def preview_publish(body: PublishIn, dev: Device = Depends(auth.school_member)):
    with db.connect(dev.schools) as con:
        st, school_name, events = _load_student_and_events(con, body.student_id)
    is_minor, age_band = _is_minor(st.get("birth_year"))
    snap = build_snapshot(st, school_name, events, body.avatar, body.interest_tags, is_minor, age_band)
    return {"visibility": body.visibility, "is_minor": is_minor, "snapshot": snap.model_dump()}


@router.post("/profile/publish", summary="Publish or unpublish a student's allow-listed profile snapshot")
def publish_profile(body: PublishIn, dev: Device = Depends(auth.school_member)):
    with db.connect(dev.schools) as con:
        st, school_name, events = _load_student_and_events(con, body.student_id)
        is_minor, age_band = _is_minor(st.get("birth_year"))
        if body.visibility == "private":
            con.execute("delete from published_profile where student_id = %s", (body.student_id,))
            return {"ok": True, "visibility": "private", "slug": None}
        _check_publish_rules(con, st, body.visibility, is_minor)
        snap = build_snapshot(st, school_name, events, body.avatar, body.interest_tags, is_minor, age_band)
        old = con.execute("select slug from published_profile where student_id = %s", (body.student_id,)).fetchone()
        slug = old["slug"] if old else secrets.token_urlsafe(16)
        con.execute(
            "insert into published_profile(student_id, school_id, slug, visibility, snapshot, is_minor, updated_at) "
            "values (%s, %s, %s, %s, %s, %s, now()) "
            "on conflict (student_id) do update set visibility = excluded.visibility, snapshot = excluded.snapshot, "
            "is_minor = excluded.is_minor, updated_at = now()",
            (body.student_id, st["school_id"], slug, body.visibility, Jsonb(snap.model_dump()), is_minor))
        return {"ok": True, "visibility": body.visibility, "slug": slug, "snapshot": snap.model_dump()}


@router.delete("/profile/publish/{student_id}", summary="Instant unpublish of a student's profile")
def unpublish_profile(student_id: str, dev: Device = Depends(auth.school_member)):
    with db.connect(dev.schools) as con:
        con.execute("delete from published_profile where student_id = %s", (student_id,))
    return {"ok": True}


@router.post("/consent/guardian-otp", summary="Send a guardian OTP for minor consent (stores only HMAC, never raw phone)",
             dependencies=[Depends(limit("guardian_otp", per_minute=10))])
def send_guardian_otp(body: GuardianOtpIn, dev: Device = Depends(auth.school_member)):
    from .accounts import login_hash, normalise
    kind, norm = normalise(body.phone)
    if kind != "phone":
        raise HTTPException(400, "Enter a valid phone number")
    ghmac = login_hash(norm)
    code = f"{secrets.randbelow(1_000_000):06d}"
    chash = hashlib.sha256(f"{ghmac}|{code}".encode("utf-8")).hexdigest()
    exp = datetime.now(tz=timezone.utc) + timedelta(minutes=OTP_TTL_MIN)
    with db.connect(dev.schools) as con:
        if not con.execute("select 1 from student where id = %s", (body.student_id,)).fetchone():
            raise HTTPException(404, "Sync this student first")
        con.execute(
            "insert into guardian_otp(student_id, guardian_hmac, code_hash, expires_at, tries, verified_at) "
            "values (%s, %s, %s, %s, 0, null) on conflict (student_id) do update set "
            "guardian_hmac = excluded.guardian_hmac, code_hash = excluded.code_hash, expires_at = excluded.expires_at, "
            "tries = 0, verified_at = null",
            (body.student_id, ghmac, chash, exp))
    return {"ok": True, **({"demo_code": code} if settings.OTP_DEMO else {})}


@router.post("/consent/guardian-otp/verify", summary="Verify guardian OTP and mark consent method as otp",
             dependencies=[Depends(limit("guardian_otp", per_minute=10))])
def verify_guardian_otp(body: GuardianOtpVerifyIn, dev: Device = Depends(auth.school_member)):
    now = datetime.now(tz=timezone.utc)
    with db.connect(dev.schools) as con:
        row = con.execute("select * from guardian_otp where student_id = %s", (body.student_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Request a guardian code first")
        if row["tries"] >= OTP_MAX_TRIES:
            raise HTTPException(429, "Too many wrong codes")
        if row["expires_at"] < now:
            raise HTTPException(400, "Code expired")
        cand = hashlib.sha256(f"{row['guardian_hmac']}|{body.code.strip()}".encode("utf-8")).hexdigest()
        if not hmac.compare_digest(cand, row["code_hash"]):
            con.execute("update guardian_otp set tries = tries + 1 where student_id = %s", (body.student_id,))
            raise HTTPException(400, "Wrong code")
        con.execute("update guardian_otp set verified_at = %s where student_id = %s", (now, body.student_id))
        con.execute("update consent set method = 'otp' where student_id = %s and revoked_at is null", (body.student_id,))
    return {"ok": True, "method": "otp"}


@router.get("/public/profile/{slug}", summary="Public allow-listed profile snapshot (adults only, noindex, no-store)",
            dependencies=[Depends(limit("public_profile", per_minute=20))])
def public_profile(slug: str, response: Response):
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Cache-Control"] = "no-store"
    with db.connect() as con:
        row = con.execute(
            "select p.snapshot, p.visibility, p.is_minor from published_profile p "
            "join consent c on c.student_id = p.student_id "
            "where p.slug = %s and p.visibility = 'public' and p.is_minor is false "
            "and c.revoked_at is null and 'publish_profile' = any(c.scopes)",
            (slug,)).fetchone()
        if not row:
            raise HTTPException(404, "Profile not found")
        con.execute(
            "insert into published_profile_views(slug, day, views) values (%s, current_date, 1) "
            "on conflict (slug, day) do update set views = published_profile_views.views + 1",
            (slug,))
    return row["snapshot"]
