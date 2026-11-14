"""API v2: evidence events.

POST /v2/sync is the only way events reach the server. Phones send what they recorded offline and get
back events made on other devices (teacher ratings, buyer confirmations) for the students they hold.
Sending the same event twice is harmless: ids are ULIDs made on the phone.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import db, kb
from ..adapters import gemini_vision
from ..adapters.gemini import GeminiUnavailable
from ..schemas import validate_event
from ..services import tracing

router = APIRouter(prefix="/v2", tags=["v2"])

MAX_EVENTS_PER_SYNC = 500
PAGE = 500


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
    student_ids: list[str] = Field([], description="Every student on this phone, to fetch their events from other devices")


def _ts(ms: float | None) -> datetime | None:
    return None if ms is None else datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _save_students(con, students: list[StudentIn]) -> None:
    for s in students:
        con.execute(
            "insert into student(id, school_id, facilitator_code, district, class, gender, medium, birth_year) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict (id) do update set "
            "school_id = coalesce(excluded.school_id, student.school_id), "
            "facilitator_code = coalesce(excluded.facilitator_code, student.facilitator_code), "
            "district = coalesce(excluded.district, student.district), class = coalesce(excluded.class, student.class), "
            "gender = coalesce(excluded.gender, student.gender), medium = coalesce(excluded.medium, student.medium), "
            "birth_year = coalesce(excluded.birth_year, student.birth_year)",
            (s.id, s.school_id, s.facilitator_code, s.district, s.class_, s.gender, s.medium, s.birth_year))
        if s.name is not None:
            con.execute("insert into student_private(student_id, name) values (%s, %s) "
                        "on conflict (student_id) do update set name = excluded.name", (s.id, s.name))
        if s.consent:
            c = s.consent
            con.execute(
                "insert into consent(id, student_id, guardian_name, scopes, method, granted_at, revoked_at) "
                "values (%s, %s, %s, %s, %s, %s, %s) on conflict (id) do update set "
                "scopes = excluded.scopes, revoked_at = excluded.revoked_at",
                (c.id, s.id, c.guardian_name, c.scopes, c.method, _ts(c.granted_at), _ts(c.revoked_at)))


def _consented(con, student_ids: set[str]) -> set[str]:
    """Students with a current consent that covers assessment."""
    if not student_ids:
        return set()
    rows = con.execute("select distinct student_id from consent where student_id = any(%s) "
                       "and revoked_at is null and 'assess' = any(scopes)", (list(student_ids),))
    return {r["student_id"] for r in rows}


def _insert_events(con, device_id: str, events: list[dict]) -> tuple[list[str], list[dict]]:
    accepted: list[str] = []
    rejected: list[dict] = []
    ok_students = _consented(con, {e.get("student_id") for e in events if e.get("student_id")})
    known_raters = {r["id"] for r in con.execute("select id from rater where id = any(%s)",
                                                 ([e["rater_id"] for e in events if e.get("rater_id")],))}
    # Oldest first, so a rating can refer to a sample sent in the same batch.
    for e in sorted(events, key=lambda x: str(x.get("id"))):
        errs = validate_event(e)
        if not errs and e["student_id"] not in ok_students:
            errs = ["no consent to assess this student"]
        if not errs and e.get("rater_id") and e["rater_id"] not in known_raters:
            errs = ["unknown rater"]
        if not errs and e.get("refers_to"):
            if not con.execute("select 1 from evidence_event where id = %s", (e["refers_to"],)).fetchone():
                errs = ["refers_to an event the server does not have yet"]
        if errs:
            rejected.append({"id": e.get("id"), "errors": errs})
            continue
        con.execute(
            "insert into evidence_event(id, student_id, device_id, kind, skill_id, subskill_id, item_id, payload, "
            "rater_id, refers_to, created_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "on conflict (id) do nothing",
            (e["id"], e["student_id"], e["device_id"] or device_id, e["kind"], e.get("skill_id"), e.get("subskill_id"),
             e.get("item_id"), Jsonb(e.get("payload") or {}), e.get("rater_id"), e.get("refers_to"),
             _ts(e["created_at"])))
        accepted.append(e["id"])
    return accepted, rejected


def refresh_state(con, student_ids: set[str]) -> None:
    """Rebuilds skill_state and aptitude_state for these students from all their events."""
    if not student_ids:
        return
    raters = {r["id"]: r["agreement"] for r in con.execute("select id, agreement from rater")}
    now = datetime.now(tz=timezone.utc)
    for sid in sorted(student_ids):
        rows = con.execute("select * from evidence_event where student_id = %s", (sid,)).fetchall()
        events = [_row_to_event(r) for r in rows]
        profile = tracing.fold_events(events, {"now": _ms(now), "items": kb.items(), "rubrics": kb.rubrics(),
                                               "raterWeights": raters})
        con.execute("delete from skill_state where student_id = %s", (sid,))
        for uid, u in profile["units"].items():
            con.execute("insert into skill_state(student_id, subskill_id, p_level, theta, se, updated_at) "
                        "values (%s, %s, %s, null, null, %s)", (sid, uid, u["p"], now))
        con.execute("delete from aptitude_state where student_id = %s", (sid,))
        for domain, a in profile["aptitude"].items():
            con.execute("insert into aptitude_state(student_id, domain, theta, se) values (%s, %s, %s, %s)",
                        (sid, domain, a["theta"], a["se"]))


def _row_to_event(r: dict) -> dict:
    e = {k: r[k] for k in ("id", "student_id", "device_id", "kind", "payload")}
    for k in ("skill_id", "subskill_id", "item_id", "rater_id", "refers_to"):
        if r[k] is not None:
            e[k] = r[k]
    e["created_at"] = _ms(r["created_at"])
    return e


@router.post("/sync", summary="Send events recorded offline; receive events from other devices")
def sync(req: SyncIn):
    with db.connect() as con:
        _save_students(con, req.students)
        for r in req.raters:
            con.execute("insert into rater(id, role, school_id) values (%s, %s, %s) on conflict (id) do nothing",
                        (r.id, r.role, r.school_id))
        accepted, rejected = _insert_events(con, req.device_id, req.events)
        refresh_state(con, {e["student_id"] for e in req.events if e.get("id") in set(accepted)})
        wanted = sorted(set(req.student_ids) | {s.id for s in req.students})
        rows = con.execute(
            "select * from evidence_event where student_id = any(%s) and seq > %s and device_id <> %s "
            "order by seq limit %s", (wanted, req.cursor, req.device_id, PAGE + 1)).fetchall()
        more = len(rows) > PAGE
        rows = rows[:PAGE]
        cursor = rows[-1]["seq"] if rows else max(req.cursor, 0)
        if not rows:
            # Skip past everything this device has already seen (its own events).
            top = con.execute("select coalesce(max(seq), 0) as m from evidence_event where student_id = any(%s)",
                              (wanted,)).fetchone()["m"]
            cursor = max(cursor, top)
        return {"accepted": accepted, "rejected": rejected, "events": [_row_to_event(r) for r in rows],
                "cursor": cursor, "more": more}


# ---------- work samples ----------

MAX_IMAGE_BYTES = 4_000_000


@router.post("/work-sample/score", summary="Score a photo of a student's work against a checklist (AI; a teacher confirms)")
async def score_work_sample(student_id: str = Form(...), rubric_id: str = Form(...), image: UploadFile = File(...)):
    rubric = kb.rubrics().get(rubric_id)
    if not rubric:
        raise HTTPException(404, "Unknown checklist")
    with db.connect() as con:
        ok = con.execute("select 1 from consent where student_id = %s and revoked_at is null and 'photos' = any(scopes)",
                         (student_id,)).fetchone()
    if not ok:
        raise HTTPException(403, "No consent to check photos for this student")
    data = await image.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Photo too large")
    # The photo is scored in memory and never stored on the server.
    try:
        out = gemini_vision.score(rubric, data, image.content_type or "image/jpeg")
    except GeminiUnavailable:
        raise HTTPException(503, "AI scoring unavailable; a teacher will score this sample") from None
    return {**out, "rubric_id": rubric_id, "scorer": "ai"}
