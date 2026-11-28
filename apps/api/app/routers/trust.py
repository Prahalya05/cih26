"""Jobs, applications, documents and donor checks.

Teachers and employers post jobs; students apply with a resume made from their record; documents get an AI first
look and a teacher's verification; donors see an anonymous pay check per student. Rules decide every yes/no
(services/trust.py, packages/engine/src/trust.ts); the AI only reads documents and resumes, and is checked.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import auth, db, kb, settings
from ..adapters import gemini_docs
from ..adapters.gemini import GeminiUnavailable
from ..auth import Device
from ..ratelimit import limit
from ..schemas import new_ulid
from ..services import raters, tracing, trust

router = APIRouter(prefix="/v2", tags=["jobs, documents and donors"])

KINDS = ("internship", "apprenticeship", "job", "mentorship", "training")
DOC_KINDS = ("resume", "id_proof", "marksheet", "income_certificate", "ration_card_bpl", "community_certificate",
             "bank_passbook", "scholarship_letter", "photo")
# Same as APPLY_DOCS in packages/engine/src/trust.ts
APPLY_DOCS = {"internship": ["resume", "id_proof"], "apprenticeship": ["resume", "id_proof", "marksheet", "bank_passbook"],
              "job": ["resume", "id_proof"], "mentorship": ["resume"], "training": ["id_proof"]}
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_DOC_BYTES = 5_000_000


def _account_of(dev: Device) -> str:
    if not dev.account_id:
        raise HTTPException(401, "Sign in first")
    return dev.account_id


# ---------- job posts ----------

class Need(BaseModel):
    id: str
    level: int = Field(ge=1, le=4)


class PostingIn(BaseModel):
    kind: str = Field(description="internship | apprenticeship | job | mentorship | training")
    title: str = Field(min_length=3, max_length=120)
    org: str = Field(min_length=2, max_length=120)
    district: str | None = Field(None, max_length=60)
    mode: str = "onsite"
    stipend_inr_month: int | None = Field(None, ge=0, le=500_000)
    duration_months: int | None = Field(None, ge=0, le=60)
    needs: list[Need] = Field(default_factory=list, max_length=12)
    min_age: int | None = Field(None, ge=14, le=60)
    min_education: str | None = None
    seats: int | None = Field(None, ge=1, le=10_000)
    closes: str | None = Field(None, max_length=10)
    description: str | None = Field(None, max_length=1000)


@router.post("/postings", summary="Post a job, internship or apprenticeship (teacher: her school only; employer: all schools)")
def create_posting(body: PostingIn, dev: Device = Depends(auth.role_in("teacher", "employer"))):
    acc = _account_of(dev)
    if body.kind not in KINDS:
        raise HTTPException(400, f"kind must be one of {', '.join(KINDS)}")
    known = {**kb.graph().get("subskills", {}), **kb.skills()}
    bad = [n.id for n in body.needs if n.id not in known]
    if bad:
        raise HTTPException(400, f"Unknown skills: {', '.join(bad)}")
    if body.min_age is not None and body.min_age < 18 and body.kind == "job":
        # Child Labour Act: under-18s only for non-hazardous work; jobs posted here are for 18+ unless a teacher says so.
        if dev.role != "teacher":
            raise HTTPException(400, "Jobs for under-18s can only be posted by a school")
    pid = f"post_{new_ulid().lower()}"
    opp = {"id": pid, "kind": body.kind, "title": {"en": body.title}, "org": body.org,
           "org_type": "company" if dev.role == "employer" else "ngo", "district": body.district, "mode": body.mode,
           "stipend_inr_month": body.stipend_inr_month, "duration_months": body.duration_months,
           "needs": [n.model_dump() for n in body.needs], "min_age": body.min_age, "min_education": body.min_education,
           "seats": body.seats, "closes": body.closes, "apply": {"mode": "in_app"}, "description_en": body.description,
           "posted_by": dev.role, "sample": False}
    opp = {k: v for k, v in opp.items() if v is not None}
    with db.connect() as con:
        target_school = (dev.school_id or (dev.schools[0] if dev.schools else None)) if dev.role == "teacher" else None
        con.execute("insert into posting(id, account_id, role, school_id, opportunity) values (%s, %s, %s, %s, %s)",
                    (pid, acc, dev.role, target_school, Jsonb(opp)))
    return {"id": pid, "opportunity": opp}


@router.get("/postings", summary="Jobs posted for this phone's school (and by employers for everyone)")
def list_postings(dev: Device = Depends(auth.device)):
    with db.connect() as con:
        rows = con.execute(
            "select p.id, p.opportunity, p.role, p.account_id, p.created_at, "
            "(select count(*) from application a where a.posting_id = p.id) as applications "
            "from posting p where p.active and (p.school_id is null or p.school_id = any(%s) or p.account_id = %s) "
            "order by p.created_at desc limit 200", (dev.schools, dev.account_id)).fetchall()
    return {"postings": [{"id": r["id"], "opportunity": r["opportunity"], "by": r["role"],
                          "mine": r["account_id"] == dev.account_id,
                          "applications": r["applications"] if r["account_id"] == dev.account_id else None,
                          "created_at": r["created_at"].isoformat()} for r in rows]}


@router.delete("/postings/{posting_id}", summary="Close a post you made")
def close_posting(posting_id: str, dev: Device = Depends(auth.role_in("teacher", "employer"))):
    with db.connect() as con:
        n = con.execute("update posting set active = false where id = %s and account_id = %s",
                        (posting_id, _account_of(dev))).rowcount
    if not n:
        raise HTTPException(404, "Not your post")
    return {"closed": True}


# ---------- documents ----------

def _doc_rows(con, student_id: str) -> dict[str, dict]:
    return {r["kind"]: r for r in con.execute("select * from student_doc where student_id = %s", (student_id,))}


def _doc_out(r: dict) -> dict:
    return {"kind": r["kind"], "status": r["status"], "ai_note": r["ai_note"], "income_inr": r["income_inr"],
            "checked_at": r["checked_at"].isoformat() if r["checked_at"] else None}


@router.get("/docs/{student_id}", summary="Status of each document for a student (never the documents themselves)")
def list_docs(student_id: str, dev: Device = Depends(auth.school_member)):
    with db.connect(dev.schools) as con:
        auth.check_student_access(con, dev, student_id)
        return {"docs": [_doc_out(r) for r in _doc_rows(con, student_id).values()]}


@router.post("/docs/check", summary="AI first look at a document photo; the photo is not stored. A teacher verifies.",
             dependencies=[Depends(limit("ai", per_minute=20))])
async def check_doc(student_id: str = Form(...), kind: str = Form(...), image: UploadFile = File(...),
                    dev: Device = Depends(auth.school_member)):
    if kind not in DOC_KINDS:
        raise HTTPException(400, "Unknown document kind")
    mime = (image.content_type or "image/jpeg").split(";")[0]
    if mime not in IMAGE_TYPES:
        raise HTTPException(415, "Send a photo (JPEG/PNG) or a PDF")
    data = await image.read()
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(413, "File too large (max 5 MB)")
    with db.connect(dev.schools) as con:
        auth.check_student_access(con, dev, student_id)
        name = con.execute(
            "select case when name_enc is not null then pgp_sym_decrypt(name_enc, %s::text) end as name "
            "from student_private where student_id = %s",
            (settings.pii_key(), student_id),
        ).fetchone()
        if not con.execute("select 1 from student where id = %s", (student_id,)).fetchone():
            raise HTTPException(404, "Sync this student first")
    note: dict | None = None
    try:
        raw, model = gemini_docs.check_doc(data, mime, kind, (name or {}).get("name") or "")
        # Rule check on the AI's answer: only the allowed fields; numbers that look like IDs are removed from the note.
        note = {"kind": raw.get("kind"), "kind_matches": raw.get("kind") == kind, "name_matches": bool(raw.get("name_matches")),
                "readable": bool(raw.get("readable")), "note": re.sub(r"\d{4,}", "••••", str(raw.get("note", "")))[:200],
                "model": model}
        if kind == "income_certificate" and isinstance(raw.get("income_inr"), int):
            note["income_inr_read"] = raw["income_inr"]
    except GeminiUnavailable:
        note = {"note": "AI not available; the teacher will look at it", "model": None}
    with db.connect(dev.schools) as con:
        con.execute("insert into student_doc(student_id, kind, status, ai_note, updated_at) values (%s, %s, 'uploaded', %s, now()) "
                    "on conflict (student_id, kind) do update set status = 'uploaded', ai_note = excluded.ai_note, "
                    "income_inr = null, checked_by = null, checked_at = null, updated_at = now()",
                    (student_id, kind, Jsonb(note)))
    return {"kind": kind, "status": "uploaded", "ai_note": note}


class VerifyDocIn(BaseModel):
    student_id: str
    kind: str
    ok: bool
    income_inr: int | None = Field(None, ge=0, le=100_000_000, description="For an income certificate: the yearly income printed on it")


@router.post("/docs/verify", summary="A teacher marks a document verified (she saw the original) or rejected")
def verify_doc(body: VerifyDocIn, dev: Device = Depends(auth.teacher)):
    if body.kind not in DOC_KINDS:
        raise HTTPException(400, "Unknown document kind")
    with db.connect(dev.schools) as con:
        if not con.execute("select 1 from student where id = %s", (body.student_id,)).fetchone():
            raise HTTPException(404, "Not a student of your school")
        con.execute("insert into student_doc(student_id, kind, status, income_inr, checked_by, checked_at) "
                    "values (%s, %s, %s, %s, %s, now()) on conflict (student_id, kind) do update set status = excluded.status, "
                    "income_inr = excluded.income_inr, checked_by = excluded.checked_by, checked_at = now(), updated_at = now()",
                    (body.student_id, body.kind, "verified" if body.ok else "rejected", body.income_inr, dev.account_id or dev.id))
    return {"kind": body.kind, "status": "verified" if body.ok else "rejected"}


# ---------- resume ----------

def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


@router.post("/resume/read", summary="Read an uploaded resume: AI proposes skills with quotes; a rule keeps only real ones",
             dependencies=[Depends(limit("ai", per_minute=20))])
async def read_resume(file: UploadFile = File(...), _dev: Device = Depends(auth.school_member)):
    mime = (file.content_type or "image/jpeg").split(";")[0]
    if mime not in IMAGE_TYPES:
        raise HTTPException(415, "Send a photo (JPEG/PNG) or a PDF")
    data = await file.read()
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(413, "File too large (max 5 MB)")
    skills = kb.skills()
    t0 = datetime.now(tz=timezone.utc)
    try:
        raw, model = gemini_docs.read_resume(data, mime, skills)
    except GeminiUnavailable:
        raise HTTPException(503, "Resume reading is not available right now; type your details instead") from None
    text = _norm(str(raw.get("text", "")))
    kept, dropped = [], []
    for s in raw.get("skills") or []:
        sid, quote = str(s.get("id", "")), str(s.get("quote", ""))
        if sid not in skills:
            dropped.append({"value": sid, "reason": "not in the skill catalogue"})
        elif not quote or _norm(quote) not in text:
            dropped.append({"value": sid, "reason": "quote not found in the document"})
        elif sid not in {k["id"] for k in kept}:
            kept.append({"id": sid, "quote": quote})
    ms = int((datetime.now(tz=timezone.utc) - t0).total_seconds() * 1000)
    return {"skills": kept, "education": [str(x)[:160] for x in (raw.get("education") or [])][:8],
            "experience": [str(x)[:200] for x in (raw.get("experience") or [])][:8],
            "trace": {"model": model, "latency_ms": ms, "kept": [k["id"] for k in kept], "dropped": dropped}}


# ---------- applications ----------

class ResumeIn(BaseModel):
    source: str = Field(description="disha (made from her verified record) or upload")
    first_name: str = Field(max_length=40)
    headline: str | None = Field(None, max_length=160)
    skills: list[dict] = Field(default_factory=list, max_length=30)
    education: list[str] = Field(default_factory=list, max_length=10)
    experience: list[str] = Field(default_factory=list, max_length=10)
    languages: list[str] = Field(default_factory=list, max_length=6)


class ApplyIn(BaseModel):
    student_id: str
    opportunity_id: str
    kind: str
    readiness: str
    message: str | None = Field(None, max_length=500)
    resume: ResumeIn


@router.post("/applications", summary="Send an application (needs share consent and verified documents: rule.apply_docs)")
def apply(body: ApplyIn, dev: Device = Depends(auth.school_member)):
    with db.connect(dev.schools) as con:
        auth.check_student_access(con, dev, body.student_id)
        st = con.execute("select school_id from student where id = %s", (body.student_id,)).fetchone()
        if not st:
            raise HTTPException(404, "Sync this student first")
        if not con.execute("select 1 from consent where student_id = %s and revoked_at is null and 'share_portfolio' = any(scopes)",
                           (body.student_id,)).fetchone():
            raise HTTPException(403, "Her family has not agreed to share her record with employers")
        docs = {k: r["status"] for k, r in _doc_rows(con, body.student_id).items()}
    if body.resume.source == "disha":
        docs["resume"] = "verified"  # made by Disha from her verified record
    need = APPLY_DOCS.get(body.kind, ["resume"])
    missing = [k for k in need if docs.get(k) != "verified"]
    if body.readiness == "later":
        raise HTTPException(409, {"rule": "rule.apply_docs", "message": "Build the needed skills first (readiness: Later)"})
    if missing:
        raise HTTPException(409, {"rule": "rule.apply_docs", "message": "Some documents are not verified yet", "missing": missing})
    with db.connect() as con:
        post = con.execute("select id, account_id from posting where id = %s and active", (body.opportunity_id,)).fetchone()
        aid = f"app_{new_ulid().lower()}"
        con.execute("insert into application(id, student_id, school_id, opportunity_id, posting_id, employer_id, resume, docs, message) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict (student_id, opportunity_id) do update set "
                    "resume = excluded.resume, docs = excluded.docs, message = excluded.message, updated_at = now()",
                    (aid, body.student_id, st["school_id"], body.opportunity_id, post["id"] if post else None,
                     post["account_id"] if post else None, Jsonb(body.resume.model_dump()),
                     Jsonb({k: docs.get(k, "missing") for k in need}), body.message))
    return {"ok": True, "docs": {k: docs.get(k, "missing") for k in need}}


def _app_out(r: dict) -> dict:
    return {"id": r["id"], "opportunity_id": r["opportunity_id"], "status": r["status"], "resume": r["resume"],
            "docs": r["docs"], "message": r["message"], "employer_note": r["employer_note"],
            "created_at": r["created_at"].isoformat(), "updated_at": r["updated_at"].isoformat()}


@router.get("/applications/student/{student_id}", summary="A student's applications and their status")
def student_applications(student_id: str, dev: Device = Depends(auth.school_member)):
    with db.connect(dev.schools) as con:
        auth.check_student_access(con, dev, student_id)
        rows = con.execute("select * from application where student_id = %s order by created_at desc", (student_id,)).fetchall()
    return {"applications": [_app_out(r) for r in rows]}


@router.get("/applications/received", summary="Applications to the posts you made (first name, skills and document status only)")
def received(dev: Device = Depends(auth.role_in("teacher", "employer"))):
    acc = _account_of(dev)
    with db.connect() as con:
        rows = con.execute("select a.*, p.opportunity->'title'->>'en' as title from application a join posting p on p.id = a.posting_id "
                           "where p.account_id = %s order by a.created_at desc limit 300", (acc,)).fetchall()
    return {"applications": [{**_app_out(r), "title": r["title"]} for r in rows]}


class StatusIn(BaseModel):
    status: str
    note: str | None = Field(None, max_length=300)


@router.patch("/applications/{app_id}", summary="The poster moves an application on: seen, shortlisted, not selected, hired")
def set_status(app_id: str, body: StatusIn, dev: Device = Depends(auth.role_in("teacher", "employer"))):
    if body.status not in ("seen", "shortlisted", "not_selected", "hired"):
        raise HTTPException(400, "Unknown status")
    with db.connect() as con:
        n = con.execute("update application a set status = %s, employer_note = %s, updated_at = now() from posting p "
                        "where a.id = %s and p.id = a.posting_id and p.account_id = %s",
                        (body.status, body.note, app_id, _account_of(dev))).rowcount
    if not n:
        raise HTTPException(404, "Not an application to your post")
    return {"ok": True}


# ---------- donor pay check ----------

def _pseudonym(student_id: str) -> str:
    return "S-" + hmac.new(settings.AUTH_SECRET.encode(), student_id.encode(), hashlib.sha256).hexdigest()[:6].upper()


def ai_kappa(events: list[dict]) -> tuple[float | None, str]:
    """The AI rater's agreement with teachers, or None until there are enough pairs. DEMO_AI_KAPPA fills in for demos."""
    stats = raters.ai_agreement(events)
    if stats["n"] >= raters.MIN_AI_PAIRS:
        return stats["agreement"], f"{stats['n']} pairs"
    demo = os.getenv("DEMO_AI_KAPPA")
    return (float(demo), "demo calibration") if demo else (None, f"only {stats['n']} pairs")


@router.get("/funder/paycheck", summary="Anonymous pay check per student (rule.paycheck): who may be paid, and why not yet")
def paycheck(need_level: int = 3, dev: Device = Depends(auth.role_in("funder"))):
    from .v2 import _row_to_event
    with db.connect() as con:  # trusted: every school, but only students who agreed to share, and no names leave here
        ids = [r["student_id"] for r in con.execute(
            "select distinct student_id from consent where revoked_at is null and 'share_portfolio' = any(scopes)")]
        if not ids:
            return {"students": [], "rule": trust.PAYCHECK_RULE}
        evs = con.execute("select * from evidence_event where student_id = any(%s) order by created_at, id", (ids,)).fetchall()
        docs = con.execute("select student_id, kind, status, income_inr from student_doc where student_id = any(%s)", (ids,)).fetchall()
        districts = {r["id"]: r["district"] for r in con.execute("select id, district from student where id = any(%s)", (ids,))}
        weights = {r["id"]: r["agreement"] for r in con.execute("select id, agreement from rater")}
    by: dict[str, list[dict]] = {i: [] for i in ids}
    for r in evs:
        by[r["student_id"]].append(_row_to_event(r))
    now_ms = datetime.now(tz=timezone.utc).timestamp() * 1000
    subs = kb.graph().get("subskills", {})
    out = []
    for sid in ids:
        events = by[sid]
        if not events:
            continue
        prof = tracing.fold_events(events, {"now": now_ms, "items": kb.items(), "rubrics": kb.rubrics(), "raterWeights": weights})
        ovs = trust.overrides(events)
        # her best shown sub-skill
        units = sorted(prof["units"].items(), key=lambda kv: (kv[1]["performance"], kv[1]["level"], kv[1]["confidence"]), reverse=True)
        if not units:
            continue
        uid, u = units[0]
        level, up = u["level"], False
        if uid in ovs and isinstance(ovs[uid]["level"], int):
            up = ovs[uid]["level"] > level
            level = ovs[uid]["level"]
        mine = [d for d in docs if d["student_id"] == sid]
        verified = [d["kind"] for d in mine if d["status"] == "verified"]
        income = next((d["income_inr"] for d in mine if d["kind"] == "income_certificate" and d["status"] == "verified"), None)
        vids = [e for e in events if e["kind"] == "work_sample" and (e.get("payload") or {}).get("media") == "video"]
        ident = ((vids[-1].get("payload") or {}).get("identity") or {}).get("status", "unknown") if vids else "not_needed"
        check = trust.pay_check({"skill": {"unit": uid, "level": level, "needLevel": need_level, "performance": u["performance"],
                                           "overriddenUp": up},
                                 "income_inr": income, "verified_docs": verified, "consent_share": True,
                                 "identity": ident, "already_paid": False})
        out.append({"student": _pseudonym(sid), "district": districts.get(sid), "unit": uid,
                    "unit_name": (subs.get(uid) or kb.skills().get(uid) or {}).get("name", {"en": uid}),
                    "level": level, **check})
    out.sort(key=lambda r: (not r["ok"], -r["level"]))
    return {"students": out, "rule": trust.PAYCHECK_RULE, "need_level": need_level}
