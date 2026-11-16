"""API v2: evidence events.

POST /v2/sync is the only way events reach the server. Phones send what they recorded offline and get
back events made on other devices (teacher ratings, buyer confirmations) for the students they hold.
Sending the same event twice is harmless: ids are ULIDs made on the phone.

Every endpoint that touches student data needs a device token (app/auth.py) and only sees that phone's
school. Phones get the token from POST /v2/devices with a join code.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import auth, db, kb
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


@router.post("/devices", summary="Register this phone with a class or teacher code; returns its device token")
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
    """Returns the ids that belong to another school. Students synced before phones had tokens have no school:
    the first school to sync them takes them."""
    ids = {i for i in ids if isinstance(i, str)}
    if not ids:
        return set()
    with db.connect() as con:  # trusted: must see every school to tell "another school" from "new"
        rows = con.execute("select id, school_id from student where id = any(%s)", (sorted(ids),)).fetchall()
        orphans = [r["id"] for r in rows if r["school_id"] is None]
        if orphans:
            con.execute("update student set school_id = %s where id = any(%s) and school_id is null",
                        (dev.school_id, orphans))
    return {r["id"] for r in rows if r["school_id"] not in (None, dev.school_id)}


def _save_students(con, students: list[StudentIn], school_id: str) -> None:
    """The school always comes from the phone's token, never from what the phone says."""
    for s in students:
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
        if s.name is not None or guardian is not None:
            # Names are kept only in student_private (checked in CI by scripts/check_privacy.py).
            con.execute("insert into student_private(student_id, name, guardian_name) values (%s, %s, %s) "
                        "on conflict (student_id) do update set name = coalesce(excluded.name, student_private.name), "
                        "guardian_name = coalesce(excluded.guardian_name, student_private.guardian_name)",
                        (s.id, s.name, guardian))
        if s.consent:
            c = s.consent
            con.execute(
                "insert into consent(id, student_id, scopes, method, granted_at, revoked_at) "
                "values (%s, %s, %s, %s, %s, %s) on conflict (id) do update set scopes = excluded.scopes, "
                "method = excluded.method, granted_at = excluded.granted_at, revoked_at = excluded.revoked_at",
                (c.id, s.id, c.scopes, c.method, _ts(c.granted_at), _ts(c.revoked_at)))


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
    # A rating counts only from a teacher's phone, and only with a rater of the same school.
    known_raters = {r["id"] for r in con.execute("select id from rater where id = any(%s) and school_id = %s",
                                                 ([e["rater_id"] for e in events if e.get("rater_id")], dev.school_id))}
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
    raters = {r["id"]: r["agreement"] for r in con.execute("select id, agreement from rater")}
    now = datetime.now(tz=timezone.utc)
    ids = sorted(student_ids)
    by_student: dict[str, list[dict]] = {sid: [] for sid in ids}
    for r in con.execute("select * from evidence_event where student_id = any(%s)", (ids,)):
        by_student[r["student_id"]].append(_row_to_event(r))
    skills, aptitudes = [], []
    for sid in ids:
        profile = tracing.fold_events(by_student[sid], {"now": _ms(now), "items": kb.items(), "rubrics": kb.rubrics(),
                                                        "raterWeights": raters})
        skills += [(sid, uid, u["p"], now) for uid, u in profile["units"].items()]
        aptitudes += [(sid, d, a["theta"], a["se"]) for d, a in profile["aptitude"].items()]
    con.execute("delete from skill_state where student_id = any(%s)", (ids,))
    con.execute("delete from aptitude_state where student_id = any(%s)", (ids,))
    _insert_rows(con, "insert into skill_state(student_id, subskill_id, p_level, updated_at)", skills)
    _insert_rows(con, "insert into aptitude_state(student_id, domain, theta, se)", aptitudes)


def _row_to_event(r: dict) -> dict:
    e = {k: r[k] for k in ("id", "student_id", "device_id", "kind", "payload")}
    for k in ("skill_id", "subskill_id", "item_id", "rater_id", "refers_to"):
        if r[k] is not None:
            e[k] = r[k]
    e["created_at"] = _ms(r["created_at"])
    return e


@router.post("/sync", summary="Send events recorded offline; receive events from other devices")
def sync(req: SyncIn, dev: Device = Depends(auth.device)):
    if req.device_id != dev.id:
        raise HTTPException(403, "device_id does not match this phone's token")
    foreign = _claim_students(dev, {s.id for s in req.students} | set(req.student_ids)
                              | {e.get("student_id") for e in req.events})
    with db.connect(dev.schools) as con:
        _save_students(con, [s for s in req.students if s.id not in foreign], dev.school_id)
        if dev.is_teacher:
            for r in req.raters:
                if r.role in PHONE_RATER_ROLES:
                    con.execute("insert into rater(id, role, school_id) values (%s, %s, %s) on conflict (id) do nothing",
                                (r.id, r.role, dev.school_id))
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


class ConfirmIn(BaseModel):
    on_time: bool
    quality: bool
    rehire: bool


@router.post("/orders/{event_id}/link", summary="Make a one-time link the buyer opens to confirm a paid job")
def order_link(event_id: str, dev: Device = Depends(auth.device)):
    with db.connect(dev.schools) as con:
        ev = con.execute("select id, student_id, kind from evidence_event where id = %s", (event_id,)).fetchone()
        if not ev or ev["kind"] != "order":
            raise HTTPException(404, "Unknown job; sync the phone first")
        old = con.execute("select token from confirm_token where event_id = %s and used_at is null and expires_at > now()",
                          (event_id,)).fetchone()
        if old:
            return {"token": old["token"]}
        token = secrets.token_urlsafe(12)
        con.execute("insert into confirm_token(token, event_id, student_id, expires_at) values (%s, %s, %s, %s)",
                    (token, event_id, ev["student_id"], datetime.now(tz=timezone.utc) + timedelta(days=LINK_DAYS)))
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


@router.get("/confirm/{token}", summary="What the buyer is asked to confirm (first name only)")
def confirm_info(token: str):
    with db.connect() as con:
        row = _token_row(con, token)
        name = con.execute("select name from student_private where student_id = %s", (row["student_id"],)).fetchone()
    first = (name["name"] if name and name["name"] else "").split(" ")[0]
    skill = kb.skills().get(row["skill_id"], {}).get("name", {"en": row["skill_id"]})
    p = row["payload"] or {}
    return {"student": first, "skill": skill, "what": p.get("what", ""), "amount_inr": p.get("amount_inr")}


@router.post("/confirm/{token}", summary="The buyer's three answers; recorded as a rating of the job. Works once.")
def confirm(token: str, body: ConfirmIn):
    with db.connect() as con:
        row = _token_row(con, token)
        rater = f"buyer_{token[:8]}"
        con.execute("insert into rater(id, role) values (%s, 'buyer') on conflict (id) do nothing", (rater,))
        now = datetime.now(tz=timezone.utc)
        con.execute(
            "insert into evidence_event(id, student_id, device_id, kind, skill_id, payload, rater_id, refers_to, created_at) "
            "values (%s, %s, 'buyer_link', 'rating', %s, %s, %s, %s, %s)",
            (new_ulid(), row["student_id"], row["skill_id"], Jsonb(body.model_dump()), rater, row["event_id"], now))
        con.execute("update confirm_token set used_at = %s where token = %s", (now, token))
        refresh_state(con, {row["student_id"]})
    return {"ok": True}


# ---------- delete my data (Step 11.2) ----------

class DeleteIn(BaseModel):
    confirmed_by: str = Field(description="guardian, or student when 18 or over")


@router.delete("/student/{student_id}", summary="Erase a student and everything about her. Keeps only a count.")
def delete_student(student_id: str, body: DeleteIn, dev: Device = Depends(auth.device)):
    if body.confirmed_by not in ("guardian", "student"):
        raise HTTPException(400, "A guardian (or the student, if 18 or over) must confirm")
    with db.connect() as con:  # trusted look-up, so another school's student is refused rather than skipped
        rows = [con.execute(f"select school_id from {t} where id = %s", (student_id,)).fetchone()
                for t in ("student", "legacy_student_doc")]
    if any(r and r["school_id"] not in (None, dev.school_id) for r in rows):
        raise HTTPException(403, "This student belongs to another school")
    with db.connect() as con:
        # Every table with a student_id cascades from student (migrations 0001, 0005); the legacy v1
        # tables have no foreign key, so they are cleared by hand.
        con.execute("delete from legacy_action where student_id = %s", (student_id,))
        con.execute("delete from legacy_student_doc where id = %s", (student_id,))
        gone = con.execute("delete from student where id = %s", (student_id,)).rowcount > 0
        if gone:
            con.execute("insert into deletion_count(day, n) values (current_date, 1) "
                        "on conflict (day) do update set n = deletion_count.n + 1")
    return {"deleted": gone}
