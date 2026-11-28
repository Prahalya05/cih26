"""API v2: evidence events.

POST /v2/sync is the only way events reach the server. Phones send what they recorded offline and get
back events made on other devices (teacher ratings, buyer confirmations) for the students they hold.
Sending the same event twice is harmless: ids are ULIDs made on the phone.

Every endpoint that touches student data needs a device token (app/auth.py) and only sees that phone's
school. Phones get the token from POST /v2/devices with a join code.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import auth, db, kb, settings
from ..ratelimit import limit
from ..auth import Device
from ..adapters import gemini_vision
from ..adapters.gemini import GeminiUnavailable
from ..schemas import new_ulid, validate_event
from ..services import safety, tracing

router = APIRouter(prefix="/v2", tags=["v2"])

MAX_EVENTS_PER_SYNC = 500
PAGE = 500
# Event numbers (seq) are handed out on insert but become visible on commit, and the two orders can differ
# when phones sync at the same time. So the cursor never moves past events younger than this: a late commit
# with a lower number is then still sent. Recent events may be sent twice; phones skip ids they already have.
SETTLE_SECONDS = 60
# Raters a phone may register. Buyers are created only by the buyer's own confirmation link.
PHONE_RATER_ROLES = {"teacher", "mentor", "family", "facilitator"}


# ---------- registering a phone ----------

class EnrolIn(BaseModel):
    device_id: str = Field(min_length=4, max_length=100)
    code: str = Field(min_length=1, max_length=64, description="Class code (student phone) or teacher code")


@router.post("/devices", summary="Register this phone with a class or teacher code; returns its device token",
             dependencies=[Depends(limit("devices", per_minute=10))])  # class codes must not be guessable by brute force
def enrol(body: EnrolIn):
    code = body.code.strip().upper()
    with db.connect() as con:
        jc = con.execute("select school_id, role, class_code from join_code where code = %s and revoked_at is null",
                         (code,)).fetchone()
        if not jc:
            raise HTTPException(404, "Unknown class code")
        old = con.execute("select school_id, role, revoked_at from device where id = %s", (body.device_id,)).fetchone()
        if old and old["revoked_at"] is not None:
            raise HTTPException(403, "This phone has been switched off; ask the school")
        if old and old["school_id"] != jc["school_id"]:
            raise HTTPException(409, "This phone is registered with another school")
        # The role comes only from the code typed now, so a class code can never take over a teacher's phone.
        if old and old["role"] == "teacher" and jc["role"] != "teacher":
            raise HTTPException(409, "This is a teacher's phone; enter the teacher code")
        token = auth.new_token()
        con.execute("insert into device(id, school_id, role, token_hash) values (%s, %s, %s, %s) "
                    "on conflict (id) do update set role = excluded.role, token_hash = excluded.token_hash",
                    (body.device_id, jc["school_id"], jc["role"], auth.hash_token(token)))
    return {"token": token, "school_id": jc["school_id"], "role": jc["role"], "class_code": jc["class_code"]}


class ConsentIn(BaseModel):
    id: str
    scopes: list[str]
    method: str
    granted_at: float
    guardian_name: str | None = None
    revoked_at: float | None = None


class StudentIn(BaseModel):
    id: str
    name: str | None = None
    phone: str | None = None
    facilitator_code: str | None = None
    school_id: str | None = None
    district: str | None = None
    class_: int | None = Field(None, alias="class")
    gender: str | None = None
    medium: str | None = None
    birth_year: int | None = None
    consent: ConsentIn | None = None


class RaterIn(BaseModel):
    id: str
    role: str
    school_id: str | None = None


class SyncIn(BaseModel):
    device_id: str
    students: list[StudentIn] = []
    raters: list[RaterIn] = []
    events: list[dict] = Field([], max_length=MAX_EVENTS_PER_SYNC)
    cursor: int = 0
    page_from: int | None = Field(None, description="Within one sync: continue after this seq (from the last answer)")
    student_ids: list[str] = Field([], description="Every student on this phone, to fetch their events from other devices")


def _ts(ms: float | None) -> datetime | None:
    return None if ms is None else datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _claim_students(dev: Device, ids: set) -> set[str]:
    """Returns the ids that belong to another school (or another student account).
    Students synced before phones had tokens have no school: the first school to sync them takes them."""
    ids = {i for i in ids if isinstance(i, str)}
    if not ids:
        return set()
    allowed = set(dev.schools)
    default_school = dev.school_id or (dev.schools[0] if dev.schools else None)
    with db.connect() as con:  # trusted: must see every school to tell "another school" from "new"
        forbidden = auth.forbidden_student_ids(con, dev, ids)
        rows = con.execute("select id, school_id from student where id = any(%s)", (sorted(ids),)).fetchall()
        orphans = [r["id"] for r in rows if r["school_id"] is None and r["id"] not in forbidden]
        if orphans and default_school:
            con.execute("update student set school_id = %s where id = any(%s) and school_id is null",
                        (default_school, orphans))
    return forbidden | {r["id"] for r in rows if r["school_id"] is not None and r["school_id"] not in allowed}


def _save_students(con, students: list[StudentIn], default_school: str, room_schools: dict[str, str] | None = None) -> None:
    """The school always comes from the phone's token/classrooms, never from what the phone says."""
    for s in students:
        school_id = (room_schools or {}).get((s.facilitator_code or "").upper(), default_school)
        con.execute(
            "insert into student(id, school_id, facilitator_code, district, class, gender, medium, birth_year) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict (id) do update set "
            "school_id = coalesce(excluded.school_id, student.school_id), "
            "facilitator_code = coalesce(excluded.facilitator_code, student.facilitator_code), "
            "district = coalesce(excluded.district, student.district), class = coalesce(excluded.class, student.class), "
            "gender = coalesce(excluded.gender, student.gender), medium = coalesce(excluded.medium, student.medium), "
            "birth_year = coalesce(excluded.birth_year, student.birth_year)",
            (s.id, school_id, s.facilitator_code, s.district, s.class_, s.gender, s.medium, s.birth_year))
        guardian = s.consent.guardian_name if s.consent else None
        if s.name is not None or s.phone is not None or guardian is not None:
            # Names and phone numbers are kept only in student_private (checked in CI by scripts/check_privacy.py)
            # and encrypted at rest via pgcrypto using PII_KEY.
            key = settings.pii_key()
            con.execute(
                "insert into student_private(student_id, name_enc, phone_enc, guardian_name_enc) "
                "values (%s, pgp_sym_encrypt(%s::text, %s::text), pgp_sym_encrypt(%s::text, %s::text), pgp_sym_encrypt(%s::text, %s::text)) "
                "on conflict (student_id) do update set "
                "name_enc = coalesce(excluded.name_enc, student_private.name_enc), "
                "phone_enc = coalesce(excluded.phone_enc, student_private.phone_enc), "
                "guardian_name_enc = coalesce(excluded.guardian_name_enc, student_private.guardian_name_enc)",
                (s.id, s.name, key, s.phone, key, guardian, key))
        if s.consent:
            c = s.consent
            con.execute(
                "insert into consent(id, student_id, scopes, method, granted_at, revoked_at) "
                "values (%s, %s, %s, %s, %s, %s) on conflict (id) do update set scopes = excluded.scopes, "
                "method = excluded.method, granted_at = excluded.granted_at, revoked_at = excluded.revoked_at",
                (c.id, s.id, c.scopes, c.method, _ts(c.granted_at), _ts(c.revoked_at)))
            if c.revoked_at is not None or "publish_profile" not in (c.scopes or []):
                con.execute("delete from published_profile where student_id = %s", (s.id,))


def _insert_rows(con, head: str, rows: list[tuple], tail: str = "", chunk: int = 20) -> None:
    """Inserts many rows with one multi-row VALUES statement per chunk (one round trip each). Chunks stay
    small (under about 8 KB) because larger requests hit a 40 ms TCP delayed-ACK stall on some networks."""
    if not rows:
        return
    one = "(" + ", ".join(["%s"] * len(rows[0])) + ")"
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        con.execute(f"{head} values {', '.join([one] * len(part))} {tail}", [v for r in part for v in r])


def _consented(con, student_ids: set[str]) -> set[str]:
    """Students with a current consent that covers assessment."""
    if not student_ids:
        return set()
    rows = con.execute("select distinct student_id from consent where student_id = any(%s) "
                       "and revoked_at is null and 'assess' = any(scopes)", (list(student_ids),))
    return {r["student_id"] for r in rows}


def _insert_events(con, dev: Device, events: list[dict], foreign: set[str]) -> tuple[list[str], list[dict]]:
    accepted: list[str] = []
    rejected: list[dict] = []
    ok_students = _consented(con, {e.get("student_id") for e in events if e.get("student_id")} - foreign)
    # A rating counts only from a teacher's phone, and only with a rater of the same school(s).
    known_raters = {r["id"] for r in con.execute("select id from rater where id = any(%s) and school_id = any(%s)",
                                                 ([e["rater_id"] for e in events if e.get("rater_id")], dev.schools))}
    refs = list({e["refers_to"] for e in events if isinstance(e.get("refers_to"), str)})
    known_refs = {r["id"] for r in con.execute("select id from evidence_event where id = any(%s)", (refs,))} if refs else set()
    rows = []
    # Oldest first, so a rating can refer to a sample sent in the same batch.
    for e in sorted(events, key=lambda x: str(x.get("id"))):
        errs = validate_event(e)
        if not errs and e["student_id"] in foreign:
            errs = ["student belongs to another school"]
        if not errs and e["student_id"] not in ok_students:
            errs = ["no consent to assess this student"]
        if not errs and e.get("rater_id") and not dev.is_teacher:
            errs = ["only a teacher's phone can rate"]
        if not errs and e.get("rater_id") and e["rater_id"] not in known_raters:
            errs = ["unknown rater"]
        if not errs and e.get("refers_to") and e["refers_to"] not in known_refs:
            errs = ["refers_to an event the server does not have yet"]
        if errs:
            rejected.append({"id": e.get("id"), "errors": errs})
            continue
        rows.append((e["id"], e["student_id"], e["device_id"] or dev.id, e["kind"], e.get("skill_id"),
                     e.get("subskill_id"), e.get("item_id"), Jsonb(e.get("payload") or {}), e.get("rater_id"),
                     e.get("refers_to"), _ts(e["created_at"])))
        known_refs.add(e["id"])
        accepted.append(e["id"])
    # One statement for the whole batch (Step 13.3 load test).
    _insert_rows(con, "insert into evidence_event(id, student_id, device_id, kind, skill_id, subskill_id, item_id, "
                      "payload, rater_id, refers_to, created_at)", rows, "on conflict (id) do nothing")
    return accepted, rejected


def refresh_state(con, student_ids: set[str]) -> None:
    """Rebuilds skill_state and aptitude_state for these students from all their events."""
    if not student_ids:
        return
    rater_rows = list(con.execute("select id, agreement, leniency from rater"))
    raters = {r["id"]: r["agreement"] for r in rater_rows}
    leniencies = {r["id"]: r["leniency"] for r in rater_rows if r.get("leniency") is not None}
    now = datetime.now(tz=timezone.utc)
    ids = sorted(student_ids)
    by_student: dict[str, list[dict]] = {sid: [] for sid in ids}
    for r in con.execute("select * from evidence_event where student_id = any(%s)", (ids,)):
        by_student[r["student_id"]].append(_row_to_event(r))
    skills, aptitudes = [], []
    for sid in ids:
        profile = tracing.fold_events(by_student[sid], {"now": _ms(now), "items": kb.items(), "rubrics": kb.rubrics(),
                                                        "raterWeights": raters, "raterLeniency": leniencies,
                                                        "applyLeniency": settings.APPLY_RATER_LENIENCY})
        skills += [(sid, uid, u["p"], now) for uid, u in profile["units"].items()]
        aptitudes += [(sid, d, a["theta"], a["se"]) for d, a in profile["aptitude"].items()]
    con.execute("delete from skill_state where student_id = any(%s)", (ids,))
    con.execute("delete from aptitude_state where student_id = any(%s)", (ids,))
    _insert_rows(con, "insert into skill_state(student_id, subskill_id, p_level, updated_at)", skills)
    _insert_rows(con, "insert into aptitude_state(student_id, domain, theta, se)", aptitudes)
    from .publish import refresh_published_snapshots
    refresh_published_snapshots(con, student_ids)


def _row_to_event(r: dict) -> dict:
    e = {k: r[k] for k in ("id", "student_id", "device_id", "kind", "payload")}
    for k in ("skill_id", "subskill_id", "item_id", "rater_id", "refers_to"):
        if r[k] is not None:
            e[k] = r[k]
    e["created_at"] = _ms(r["created_at"])
    return e


@router.post("/sync", summary="Send events recorded offline; receive events from other devices")
def sync(req: SyncIn, dev: Device = Depends(auth.school_member)):
    if req.device_id != dev.id:
        raise HTTPException(403, "device_id does not match this phone's token")
    foreign = _claim_students(dev, {s.id for s in req.students} | set(req.student_ids)
                              | {e.get("student_id") for e in req.events})
    with db.connect(dev.schools) as con:
        room_schools: dict[str, str] = {}
        if dev.is_teacher and dev.account_id:
            room_schools = {r["code"]: r["school_id"] for r in con.execute(
                "select code, school_id from classroom where teacher_account = %s", (dev.account_id,)).fetchall()}
        default_school = dev.school_id or dev.schools[0]
        valid_students = [s for s in req.students if s.id not in foreign]
        _save_students(con, valid_students, default_school, room_schools)
        for s in valid_students:  # a student account links each of her profiles (up to STUDENT_PROFILES_MAX)
            auth.maybe_link_student(con, dev, s.id)
        if dev.is_teacher:
            for r in req.raters:
                if r.role in PHONE_RATER_ROLES:
                    con.execute("insert into rater(id, role, school_id) values (%s, %s, %s) on conflict (id) do nothing",
                                (r.id, r.role, default_school))
        accepted, rejected = _insert_events(con, dev, req.events, foreign)
        refresh_state(con, {e["student_id"] for e in req.events if e.get("id") in set(accepted)})
        # Withdrawn consent stops sync both ways: nothing is accepted or sent back for that student.
        wanted = sorted(_consented(con, (set(req.student_ids) | {s.id for s in req.students}) - foreign))
        rows = con.execute(
            "select * from evidence_event where student_id = any(%s) and seq > %s and device_id <> %s "
            "order by seq limit %s", (wanted, max(req.cursor, req.page_from or 0), req.device_id, PAGE + 1)).fetchall()
        more = len(rows) > PAGE
        rows = rows[:PAGE]
        if rows:
            reach = rows[-1]["seq"]
        else:
            # Nothing new from other devices: skip past this device's own events too.
            reach = con.execute("select coalesce(max(seq), 0) as m from evidence_event where student_id = any(%s)",
                                (wanted,)).fetchone()["m"]
        settled = con.execute(
            "select coalesce(max(seq), 0) as m from evidence_event where student_id = any(%s) "
            "and received_at < clock_timestamp() - make_interval(secs => %s)", (wanted, SETTLE_SECONDS)).fetchone()["m"]
        cursor = max(req.cursor, min(reach, settled))
        # "cursor" is safe to store; "page_from" only continues paging within this sync.
        return {"accepted": accepted, "rejected": rejected, "events": [_row_to_event(r) for r in rows],
                "cursor": cursor, "more": more, "page_from": rows[-1]["seq"] if more else None}


# ---------- work samples ----------

MAX_IMAGE_BYTES = 4_000_000


@router.post("/work-sample/score", summary="Score a photo of a student's work against a checklist (AI; a teacher confirms)")
async def score_work_sample(student_id: str = Form(...), rubric_id: str = Form(...), image: UploadFile = File(...),
                            dev: Device = Depends(auth.device)):
    rubric = kb.rubrics().get(rubric_id)
    if not rubric:
        raise HTTPException(404, "Unknown checklist")
    with db.connect(dev.schools) as con:  # another school's student has no visible consent, so is refused below
        auth.check_student_access(con, dev, student_id)
        ok = con.execute("select 1 from consent where student_id = %s and revoked_at is null and 'photos' = any(scopes)",
                         (student_id,)).fetchone()
        st = con.execute("select birth_year from student where id = %s", (student_id,)).fetchone()
    if not ok:
        raise HTTPException(403, "No consent to check photos for this student")
    # Under 18 (or age unknown): checklist items on hazardous sub-skills are never scored.
    rubric = safety.safe_rubric(kb.graph(), rubric, safety.is_minor(st["birth_year"] if st else None))
    if rubric is None:
        raise HTTPException(403, "This work sample is not allowed under 18")
    data = await image.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Photo too large")
    # The photo is scored in memory and never stored on the server.
    try:
        out = gemini_vision.score(rubric, data, image.content_type or "image/jpeg")
    except GeminiUnavailable:
        raise HTTPException(503, "AI scoring unavailable; a teacher will score this sample") from None
    return {**out, "rubric_id": rubric_id, "scorer": "ai"}


# ---------- buyer confirmation of paid jobs ----------

LINK_DAYS = 7
MAX_LINKS_PER_DAY = 5
MAX_CONFIRMS_PER_WEEK = 5
MAX_TEACHER_VERIFIES_PER_WEEK = 10
MAX_TEACHER_VERIFIES_PER_STUDENT = 2
OTP_TTL_MIN = 10
OTP_MAX_TRIES = 5


def _client_fp(request: Request) -> str:
    """Salted fingerprint of the caller's network address and user-agent for anti-self-confirm."""
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    ua = request.headers.get("user-agent", "")[:160]
    return hmac.new(settings.AUTH_SECRET.encode("utf-8"), f"fp|{ip}|{ua}".encode("utf-8"), hashlib.sha256).hexdigest()


class ConfirmIn(BaseModel):
    on_time: bool
    quality: bool
    rehire: bool
    # Customer privacy (guard.buyer_privacy): we keep the customer's name only if they say yes. Nothing else about them.
    share_name: bool = False
    buyer_name: str | None = Field(None, max_length=60)
    otp_code: str | None = Field(None, max_length=12)


class TokenIn(BaseModel):
    token: str = Field(min_length=4, max_length=128)


class ConfirmBodyIn(ConfirmIn):
    token: str = Field(min_length=4, max_length=128)


class ConfirmOtpIn(BaseModel):
    token: str = Field(min_length=4, max_length=128)
    phone: str = Field(min_length=6, max_length=32)


class TeacherVerifyIn(BaseModel):
    method: Literal["phoned buyer", "visited", "saw the product"]
    reason: str = Field(min_length=5, max_length=300)
    quality: bool = True
    rehire: bool = True


@router.post("/orders/{event_id}/link", summary="Make a one-time link the buyer opens to confirm a paid job")
def order_link(event_id: str, request: Request, dev: Device = Depends(auth.school_member)):
    fp = _client_fp(request)
    with db.connect(dev.schools) as con:
        ev = con.execute("select id, student_id, kind from evidence_event where id = %s", (event_id,)).fetchone()
        if not ev or ev["kind"] != "order":
            raise HTTPException(404, "Unknown job; sync the phone first")
        old = con.execute("select token from confirm_token where event_id = %s and used_at is null and expires_at > now()",
                          (event_id,)).fetchone()
        if old:
            return {"token": old["token"]}
        daily = con.execute(
            "select count(*) as n from confirm_token where student_id = %s and created_at > now() - interval '1 day'",
            (ev["student_id"],)).fetchone()["n"]
        if daily >= MAX_LINKS_PER_DAY:
            raise HTTPException(429, "Too many buyer links created today for this student")
        token = secrets.token_urlsafe(12)
        con.execute("insert into confirm_token(token, event_id, student_id, creator_fp, expires_at) values (%s, %s, %s, %s, %s)",
                    (token, event_id, ev["student_id"], fp, datetime.now(tz=timezone.utc) + timedelta(days=LINK_DAYS)))
        return {"token": token}


def _token_row(con, token: str) -> dict:
    row = con.execute("select t.*, e.skill_id, e.payload from confirm_token t join evidence_event e on e.id = t.event_id "
                      "where t.token = %s", (token,)).fetchone()
    if not row:
        raise HTTPException(404, "This link is not valid")
    if row["used_at"] is not None:
        raise HTTPException(410, "This job was already confirmed. Thank you!")
    if row["expires_at"] < datetime.now(tz=timezone.utc):
        raise HTTPException(410, "This link has expired")
    return row


def _confirm_info_out(token: str) -> dict:
    with db.connect() as con:
        row = _token_row(con, token)
        name = con.execute(
            "select case when name_enc is not null then pgp_sym_decrypt(name_enc, %s::text) end as name "
            "from student_private where student_id = %s",
            (settings.pii_key(), row["student_id"]),
        ).fetchone()
    first = (name["name"] if name and name["name"] else "").split(" ")[0]
    skill = kb.skills().get(row["skill_id"], {}).get("name", {"en": row["skill_id"]})
    p = row["payload"] or {}
    amount = p.get("amount_inr")
    otp_required = (
        (isinstance(amount, (int, float)) and not isinstance(amount, bool) and amount > settings.ORDER_OTP_THRESHOLD_INR)
        or bool(row.get("otp_code_hash") and not row.get("otp_verified_at"))
    )
    return {"student": first, "skill": skill, "what": p.get("what", ""), "amount_inr": amount,
            "otp_required": otp_required,
            "privacy": {"kept": ["your three answers"], "optional": ["your name, shown to the student as a thank-you"],
                        "never": ["your phone number", "your address", "your location"], "delete_after_days": 365}}


@router.post("/confirm/info", summary="What the buyer is asked to confirm (token in body, never in URL logs)",
             dependencies=[Depends(limit("confirm", per_minute=15))])
def confirm_info_body(body: TokenIn):
    return _confirm_info_out(body.token)


@router.post("/confirm/otp", summary="Buyer phone check: send a 6-digit OTP; keeps only HMAC(AUTH_SECRET, phone)",
             dependencies=[Depends(limit("confirm", per_minute=15))])
def confirm_otp(body: ConfirmOtpIn):
    from .accounts import login_hash, normalise
    kind, norm = normalise(body.phone)
    if kind != "phone":
        raise HTTPException(400, "Enter a valid phone number")
    bhmac = login_hash(norm)
    code = f"{secrets.randbelow(1_000_000):06d}"
    chash = hashlib.sha256(f"{bhmac}|{code}".encode("utf-8")).hexdigest()
    exp = datetime.now(tz=timezone.utc) + timedelta(minutes=OTP_TTL_MIN)
    with db.connect() as con:
        _token_row(con, body.token)
        con.execute("update confirm_token set buyer_hmac = %s, otp_code_hash = %s, otp_expires_at = %s, otp_tries = 0, otp_verified_at = null where token = %s",
                    (bhmac, chash, exp, body.token))
    return {"ok": True, **({"demo_code": code} if settings.OTP_DEMO else {})}


def _apply_confirm(token: str, body: ConfirmIn, request: Request) -> dict:
    fp = _client_fp(request)
    with db.connect() as con:
        row = _token_row(con, token)
        now = datetime.now(tz=timezone.utc)
        weekly = con.execute(
            "select count(*) as n from evidence_event where student_id = %s and kind = 'rating' and refers_to is not null "
            "and created_at > now() - interval '7 days' and coalesce(payload->>'unverified', 'false') != 'true'",
            (row["student_id"],)).fetchone()["n"]
        if weekly >= MAX_CONFIRMS_PER_WEEK:
            raise HTTPException(429, "Too many job confirmations this week for this student")

        amount = (row["payload"] or {}).get("amount_inr")
        requires_otp = isinstance(amount, (int, float)) and not isinstance(amount, bool) and amount > settings.ORDER_OTP_THRESHOLD_INR
        phone_verified = bool(row.get("otp_verified_at"))
        if requires_otp and not row.get("otp_code_hash") and not phone_verified:
            raise HTTPException(400, f"Buyer phone OTP is required for orders above ₹{settings.ORDER_OTP_THRESHOLD_INR}")
        if row.get("otp_code_hash") and not phone_verified:
            if not body.otp_code or not body.otp_code.strip():
                raise HTTPException(400, "Enter the 6-digit code sent to your phone")
            if row["otp_tries"] >= OTP_MAX_TRIES:
                raise HTTPException(429, "Too many wrong codes. Request a new one.")
            if row["otp_expires_at"] < now:
                raise HTTPException(400, "That code expired. Request a new one.")
            cand = hashlib.sha256(f"{row['buyer_hmac']}|{body.otp_code.strip()}".encode("utf-8")).hexdigest()
            if not hmac.compare_digest(cand, row["otp_code_hash"]):
                con.execute("update confirm_token set otp_tries = otp_tries + 1 where token = %s", (token,))
                raise HTTPException(400, "That code is not right")
            con.execute("update confirm_token set otp_verified_at = %s where token = %s", (now, token))
            phone_verified = True

        self_confirm = bool(row.get("creator_fp") and hmac.compare_digest(row["creator_fp"], fp)) and not phone_verified
        rater = f"buyer_{token[:8]}"
        con.execute("insert into rater(id, role) values (%s, 'buyer') on conflict (id) do nothing", (rater,))
        payload = {
            "on_time": body.on_time,
            "quality": body.quality,
            "rehire": body.rehire,
            **({"buyer_name": body.buyer_name.strip()[:60]} if body.share_name and body.buyer_name and body.buyer_name.strip() else {}),
            **({"unverified": True, "self_confirm": True} if self_confirm else {}),
            **({"buyer_phone_verified": True} if phone_verified else {}),
        }
        con.execute(
            "insert into evidence_event(id, student_id, device_id, kind, skill_id, payload, rater_id, refers_to, created_at) "
            "values (%s, %s, 'buyer_link', 'rating', %s, %s, %s, %s, %s)",
            (new_ulid(), row["student_id"], row["skill_id"], Jsonb(payload), rater, row["event_id"], now))
        con.execute("update confirm_token set used_at = %s where token = %s", (now, token))
        refresh_state(con, {row["student_id"]})
    return {"ok": True, "unverified": self_confirm, "buyer_phone_verified": phone_verified}


@router.post("/confirm", summary="The buyer's answers (token in body, never in URL logs)",
             dependencies=[Depends(limit("confirm", per_minute=15))])
def confirm_body(body: ConfirmBodyIn, request: Request):
    return _apply_confirm(body.token, body, request)


@router.post("/orders/{event_id}/teacher-verify", summary="Teacher verification bypass for a paid job (same school only)")
def teacher_verify_order(event_id: str, body: TeacherVerifyIn, dev: Device = Depends(auth.role_in("teacher"))):
    with db.connect(dev.schools) as con:
        ev = con.execute("select id, student_id, kind, skill_id from evidence_event where id = %s", (event_id,)).fetchone()
        if not ev or ev["kind"] != "order":
            raise HTTPException(404, "Unknown job; sync the phone first")
        existing = con.execute(
            "select id, payload from evidence_event where refers_to = %s and kind = 'rating' "
            "and coalesce(payload->>'unverified', 'false') != 'true'",
            (event_id,)).fetchone()
        if existing:
            raise HTTPException(409, "This job is already verified")
        rater = f"teacher_{dev.id}"
        teacher_weekly = con.execute(
            "select count(*) as n from evidence_event where rater_id = %s and kind = 'rating' "
            "and payload->>'verified_by' = 'teacher' and created_at > now() - interval '7 days'",
            (rater,)).fetchone()["n"]
        if teacher_weekly >= MAX_TEACHER_VERIFIES_PER_WEEK:
            raise HTTPException(429, "Too many teacher verifications this week")
        student_total = con.execute(
            "select count(*) as n from evidence_event where student_id = %s and kind = 'rating' "
            "and payload->>'verified_by' = 'teacher'",
            (ev["student_id"],)).fetchone()["n"]
        if student_total >= MAX_TEACHER_VERIFIES_PER_STUDENT:
            raise HTTPException(429, "Too many teacher verifications for this student")
        con.execute("insert into rater(id, role) values (%s, 'teacher') on conflict (id) do nothing", (rater,))
        now = datetime.now(tz=timezone.utc)
        payload = {
            "on_time": True,
            "quality": body.quality,
            "rehire": body.rehire,
            "verified_by": "teacher",
            "method": body.method,
            "reason": body.reason.strip(),
        }
        con.execute(
            "insert into evidence_event(id, student_id, device_id, kind, skill_id, payload, rater_id, refers_to, created_at) "
            "values (%s, %s, %s, 'rating', %s, %s, %s, %s, %s)",
            (new_ulid(), ev["student_id"], dev.id, ev["skill_id"], Jsonb(payload), rater, event_id, now))
        refresh_state(con, {ev["student_id"]})
    return {"ok": True}


@router.get("/orders/teacher-verifications", summary="Audit list of teacher-verified paid jobs in this school")
def teacher_verifications_audit(dev: Device = Depends(auth.role_in("teacher"))):
    with db.connect(dev.schools) as con:
        rows = con.execute(
            "select r.id, r.student_id, r.skill_id, r.rater_id, r.refers_to as order_id, r.payload, r.created_at, "
            "o.payload as order_payload "
            "from evidence_event r "
            "left join evidence_event o on o.id = r.refers_to "
            "where r.kind = 'rating' and r.payload->>'verified_by' = 'teacher' "
            "order by r.created_at desc limit 50"
        ).fetchall()
    return {"verifications": [
        {
            "id": r["id"],
            "student_id": r["student_id"],
            "skill_id": r["skill_id"],
            "order_id": r["order_id"],
            "rater_id": r["rater_id"],
            "method": (r["payload"] or {}).get("method"),
            "reason": (r["payload"] or {}).get("reason"),
            "amount_inr": (r["order_payload"] or {}).get("amount_inr"),
            "what": (r["order_payload"] or {}).get("what"),
            "created_at": _ms(r["created_at"]),
        }
        for r in rows
    ]}


# ---------- delete my data (Step 11.2) ----------

class DeleteIn(BaseModel):
    confirmed_by: str = Field(description="guardian, or student when 18 or over")


@router.delete("/student/{student_id}", summary="Erase a student and everything about her. Keeps only a count.")
def delete_student(student_id: str, body: DeleteIn, dev: Device = Depends(auth.school_member)):
    if body.confirmed_by not in ("guardian", "student"):
        raise HTTPException(400, "A guardian (or the student, if 18 or over) must confirm")
    with db.connect() as con:  # trusted look-up, so another school's student is refused rather than skipped
        auth.check_student_access(con, dev, student_id)
        rows = [con.execute("select school_id from student where id = %s", (student_id,)).fetchone()]
    if any(r and r["school_id"] is not None and r["school_id"] not in dev.schools for r in rows):
        raise HTTPException(403, "This student belongs to another school")
    with db.connect() as con:
        # Every table with a student_id cascades from student (migrations 0001, 0005); legacy_action
        # has no foreign key, so it is cleared by hand.
        con.execute("delete from legacy_action where student_id = %s", (student_id,))
        gone = con.execute("delete from student where id = %s", (student_id,)).rowcount > 0
        # and the link from her account to this profile (migration 0016)
        con.execute("delete from account_student where student_id = %s", (student_id,))
        con.execute("update account set student_id = (select min(student_id) from account_student where account_id = account.id) "
                    "where student_id = %s", (student_id,))
        if gone:
            con.execute("insert into deletion_count(day, n) values (current_date, 1) "
                        "on conflict (day) do update set n = deletion_count.n + 1")
    return {"deleted": gone}
