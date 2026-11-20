"""Disha public API, version 1. OpenAPI docs at /docs.

Partners (colleges, NGOs, employers, government systems) can use the same endpoints as the app:
knowledge base, career matching, eligibility checks, and facilitator data.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Literal

import hmac

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from .. import auth, db, kb, settings
from ..auth import Device
from ..ratelimit import limit
from ..adapters import demo_cache, gemini, gemini_tasks, keywords
from ..services import eligibility, guards, matcher, schemes

router = APIRouter(prefix="/v1")

MAX_AUDIO_BYTES = 2_000_000  # about 60 s of compressed speech


# ---------- knowledge base ----------

@router.get("/kb", summary="The whole knowledge base (careers, skills, schemes, rules)")
def get_kb():
    data = {
        "skills": list(kb.skills().values()),
        "occupations": list(kb.occupations().values()),
        "schemes": schemes.catalog()["schemes"],
        "rules": list(kb.rules().values()) + [r for r in schemes.catalog()["rules"] if r["id"] not in kb.rules()],
        "graph": {
            "subskills": list(kb.graph()["subskills"].values()),
            "aptitudes": list(kb.graph()["aptitudes"].values()),
            "edges": kb._load("graph/edges.json"),
        },
    }
    version = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
    return {"version": version, **data}


# ---------- scheme catalogue (fetched by the phones; admin can add or change schemes) ----------

@router.get("/schemes", summary="Current schemes and their eligibility rules. The phone caches them for offline use")
def get_schemes(request: Request, response: Response):
    cat = schemes.catalog()
    etag = f'"{cat["version"]}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    return cat


def _admin(x_admin_token: str | None = Header(None)) -> str:
    if not settings.ADMIN_TOKEN or not x_admin_token or not hmac.compare_digest(x_admin_token, settings.ADMIN_TOKEN):
        raise HTTPException(401, "Admin token required")
    return "admin"


class SchemeUpdate(BaseModel):
    scheme: dict
    rule: dict


@router.put("/schemes/{scheme_id}", summary="Add or change a scheme (admin). The rule must pass its own fixtures")
def put_scheme(scheme_id: str, body: SchemeUpdate, by: str = Depends(_admin)):
    scheme, rule = {**body.scheme, "id": scheme_id}, {**body.rule, "id": scheme_id}
    errs = schemes.validate(scheme, rule)
    if errs:
        raise HTTPException(422, {"errors": errs})
    schemes.upsert(scheme, rule, by)
    return {"ok": True, "version": schemes.catalog()["version"]}


@router.delete("/schemes/{scheme_id}", summary="Hide a scheme from every phone (admin)")
def delete_scheme(scheme_id: str, by: str = Depends(_admin)):
    if scheme_id not in schemes.schemes():
        raise HTTPException(404, "No such scheme")
    schemes.hide(scheme_id, by)
    return {"ok": True, "version": schemes.catalog()["version"]}


# ---------- matching and eligibility ----------

class SkillClaim(BaseModel):
    id: str
    confidence: float = Field(0.6, ge=0, le=1)
    evidence: str | None = None


class Persona(BaseModel):
    education: str = "class10"
    riasec: dict[Literal["R", "I", "A", "S", "E", "C"], float] = {}
    skills: list[SkillClaim] = []


class MatchRequest(BaseModel):
    persona: Persona
    k: int = Field(8, ge=1, le=20)


@router.post("/match", summary="Rank careers for a student profile, spread across sectors, with what-if hints")
def match(req: MatchRequest):
    unknown = [s.id for s in req.persona.skills if s.id not in kb.skills()]
    if unknown:
        raise HTTPException(422, f"Unknown skill ids: {unknown}")
    return matcher.recommend(req.persona.model_dump(), k=req.k)


class EligibilityRequest(BaseModel):
    facts: dict = Field(..., examples=[{"age": 16, "gender": "female", "state": "TN", "category": "sc",
                                        "current_class": 10, "passed_class": 9, "stage": "school",
                                        "school_type": "govt", "school_6_to_12": "govt", "tamil_medium": True,
                                        "family_income_inr": 90000}])


@router.post("/eligibility", summary="Check every scheme: eligible now, need more info, or eligible later")
def check_eligibility(req: EligibilityRequest):
    return eligibility.evaluate_all(req.facts)


# ---------- profile extraction (the only AI step) ----------

@router.post("/profile/extract", summary="Turn one spoken or typed answer into skills with quoted evidence",
             dependencies=[Depends(limit("ai", per_minute=30))])
async def extract_profile(
    question: str = Form(...),
    text: str | None = Form(None),
    audio: UploadFile | None = File(None),
    _dev: Device = Depends(auth.device),  # registered phones only: student speech, and AI calls cost money
):
    audio_bytes = await audio.read() if audio else None
    if audio_bytes and len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Recording too long")
    if not text and not audio_bytes:
        raise HTTPException(422, "Send text or audio")
    # Audio is processed in memory and never stored.
    reason = "GEMINI_API_KEY not set"
    if gemini.enabled():
        try:
            t0 = time.monotonic()
            out = gemini.extract(question, text=text, audio=audio_bytes,
                                 mime_type=(audio.content_type if audio else None) or "audio/webm")
            trace = {"model": out.pop("model", gemini_tasks.model_name()), "latency_ms": int((time.monotonic() - t0) * 1000),
                     "kept": [f"{s['id']}: \"{s['evidence']}\"" for s in out["skills"]],
                     "check": "only skill ids from the skill list, each with a quote"}
            return {**out, "source": "gemini", "trace": trace}
        except gemini.GeminiUnavailable as e:
            reason = f"AI unavailable ({str(e)[:60]})"
    if text:
        found = keywords.extract(text)
        return {"transcript": text, "skills": found, "experiences": keywords.experiences(text, found), "source": "keywords",
                "trace": {"model": "keywords", "fallback": reason}}
    return {"transcript": "", "skills": [], "experiences": [], "source": "unavailable", "trace": {"model": "none", "fallback": reason}}


@router.post("/profile/interests", summary="Interests (RIASEC) from her own words; AI suggests, a rule keeps only quoted letters",
             dependencies=[Depends(limit("ai", per_minute=30))])
async def profile_interests(
    text: str | None = Form(None),
    audio: UploadFile | None = File(None),
    lang: str = Form("ta"),
    _dev: Device = Depends(auth.device),
):
    audio_bytes = await audio.read() if audio else None
    if audio_bytes and len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Recording too long")
    if not text and not audio_bytes:
        raise HTTPException(422, "Send text or audio")
    ck = demo_cache.key("interests", text or "", audio_bytes or b"")
    hit = demo_cache.get(ck)
    if hit:
        return {**hit, "source": "cached", "trace": {**hit.get("trace", {}), "cached": True}}
    reason = "GEMINI_API_KEY not set"
    if gemini.enabled():
        try:
            data, model, ms = gemini_tasks.interests(text=text, audio=audio_bytes,
                                                     mime_type=(audio.content_type if audio else None) or "audio/webm")
            said = str(data.get("transcript") or text or "")[:2000]
            kept, dropped = guards.check_interests(data.get("interests"), said)
            out = {"transcript": said, "interests": kept, "source": "gemini",
                   "trace": {"model": model, "latency_ms": ms, "kept": [f"{k['letter']}: \"{k['evidence']}\"" for k in kept], "dropped": dropped}}
            demo_cache.put(ck, out)
            return out
        except gemini.GeminiUnavailable as e:
            reason = f"AI unavailable ({str(e)[:60]})"
    if text:
        return {"transcript": text, "interests": guards.interests_from_keywords(text), "source": "keywords",
                "trace": {"model": "keywords", "fallback": reason}}
    return {"transcript": "", "interests": [], "source": "unavailable", "trace": {"model": "none", "fallback": reason}}


class SuggestRequest(BaseModel):
    riasec: dict[str, float] | None = None
    skills: list[str] = []
    education: str | None = None
    exclude: list[str] = []
    lang: str = "en"


@router.post("/careers/suggest", summary="Wider career ideas: AI picks from the catalogue only; a rule drops anything else",
             dependencies=[Depends(limit("ai", per_minute=30))])
def careers_suggest(req: SuggestRequest, _dev: Device = Depends(auth.device)):
    profile = req.model_dump()
    ck = demo_cache.key("careers", profile)
    hit = demo_cache.get(ck)
    if hit:
        return {**hit, "source": "cached", "trace": {**hit.get("trace", {}), "cached": True}}
    if not gemini.enabled():
        return {"ideas": [], "source": "unavailable", "trace": {"model": "none", "fallback": "GEMINI_API_KEY not set"}}
    try:
        data, model, ms = gemini_tasks.suggest_careers(profile, req.lang)
    except gemini.GeminiUnavailable as e:
        return {"ideas": [], "source": "unavailable", "trace": {"model": "none", "fallback": f"AI unavailable ({str(e)[:60]})"}}
    kept, dropped = guards.check_careers(data.get("ideas"), set(req.exclude))
    out = {"ideas": kept, "source": "gemini", "trace": {"model": model, "latency_ms": ms, "kept": [k["id"] for k in kept], "dropped": dropped}}
    demo_cache.put(ck, out)
    return out


class ShortlistItem(BaseModel):
    id: str
    score: float = 0
    matched_skills: list[str] = []


class PersonaliseRequest(BaseModel):
    shortlist: list[ShortlistItem] = Field(..., min_length=1, max_length=8)
    quotes: list[str] = Field([], max_length=30)
    riasec: dict[str, float] | None = None
    education: str | None = None
    lang: str = "en"


@router.post("/careers/personalise", summary="AI orders the formula's shortlist for her and explains each with her own words",
             dependencies=[Depends(limit("ai", per_minute=30))])
def careers_personalise(req: PersonaliseRequest, _dev: Device = Depends(auth.device)):
    ids = [c.id for c in req.shortlist if c.id in kb.occupations()]
    if not ids:
        raise HTTPException(422, "No known career ids")
    shortlist = [c.model_dump() for c in req.shortlist if c.id in ids]
    quotes = [q.strip()[:300] for q in req.quotes if q and q.strip()]
    ck = demo_cache.key("personalise", shortlist, quotes, req.riasec, req.education, req.lang)
    hit = demo_cache.get(ck)
    if hit:
        return {**hit, "source": "cached", "trace": {**hit.get("trace", {}), "cached": True}}
    if not gemini.enabled():
        return {"order": ids, "why": {}, "order_reason": "", "source": "unavailable", "trace": {"model": "none", "fallback": "GEMINI_API_KEY not set"}}
    try:
        data, model, ms = gemini_tasks.personalise_careers(shortlist, quotes, req.riasec or {}, req.education, req.lang)
    except gemini.GeminiUnavailable as e:
        return {"order": ids, "why": {}, "order_reason": "", "source": "unavailable",
                "trace": {"model": "none", "fallback": f"AI unavailable ({str(e)[:60]})"}}
    out, dropped = guards.check_personalised(data, ids, quotes)
    res = {**out, "source": "gemini", "trace": {"model": model, "latency_ms": ms, "kept": out["order"], "dropped": dropped}}
    demo_cache.put(ck, res)
    return res


class Turn(BaseModel):
    q: str | None = None
    said: str = ""


class FollowupRequest(BaseModel):
    turns: list[Turn] = Field(..., min_length=1, max_length=6)
    found: list[str] = []
    lang: str = "en"


@router.post("/talk/followup", summary="One follow-up question when her answer was vague (AI writes it; a rule screens it)",
             dependencies=[Depends(limit("ai", per_minute=30))])
def talk_followup(req: FollowupRequest, _dev: Device = Depends(auth.device)):
    turns = [{"q": (t.q or "")[:300], "said": t.said[:1000]} for t in req.turns]
    found = [x for x in req.found if x in guards.RIASEC]
    if not gemini.enabled():
        return {"question": None, "source": "unavailable", "trace": {"model": "none", "fallback": "GEMINI_API_KEY not set"}}
    try:
        data, model, ms = gemini_tasks.followup(turns, found, req.lang)
    except gemini.GeminiUnavailable as e:
        return {"question": None, "source": "unavailable", "trace": {"model": "none", "fallback": f"AI unavailable ({str(e)[:60]})"}}
    q, dropped = guards.check_followup(data)
    return {"question": q, "aim": str(data.get("aim", ""))[:120], "source": "gemini" if q else "unavailable",
            "trace": {"model": model, "latency_ms": ms, "kept": [q] if q else [], "dropped": dropped}}


# ---------- offline sync and facilitator ----------

class Action(BaseModel):
    id: str
    student_id: str
    kind: Literal["endorse", "recommend", "feedback", "checkin", "apply"]
    payload: dict = {}
    by: str | None = None
    created_at: int | None = None


class SyncRequest(BaseModel):
    students: list[dict] = []
    actions: list[Action] = []
    pull: list[str] = Field([], description="Other student ids on this phone to fetch teacher actions for")


@router.post("/sync", summary="Upload students and actions saved offline; get back actions for those students")
def sync(req: SyncRequest, dev: Device = Depends(auth.school_member)):
    for s in req.students:
        if not isinstance(s.get("id"), str):
            raise HTTPException(422, "Each student needs a string id")
    # The legacy tables have no row-level security, so the school check is done here.
    with db.connect() as con:
        ids = sorted({s["id"] for s in req.students} | {a.student_id for a in req.actions} | set(req.pull))
        others = db.other_schools_students(con, dev.school_id, ids)
        stored = sum(db.upsert_student(con, s, dev.school_id) for s in req.students if s["id"] not in others)
        # Endorsing and recommending are a teacher's actions.
        added = sum(db.add_action(con, a.model_dump()) for a in req.actions
                    if a.student_id not in others and (dev.is_teacher or a.kind not in ("endorse", "recommend")))
        return {"stored_students": stored, "added_actions": added,
                "actions": db.actions_for(con, [i for i in ids if i not in others])}


@router.get("/facilitator/{code}/cohort", summary="All students linked to a facilitator code, with their actions")
def cohort(code: str, dev: Device = Depends(auth.teacher)):
    with db.connect() as con:
        students = db.cohort(con, code, dev.school_id)
        return {"students": students, "actions": db.actions_for(con, [s["id"] for s in students])}


# ---------- spoken prompts for phones without a Tamil voice ----------

class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=400)
    lang: Literal["ta", "hi", "en"] = "ta"


@router.post("/tts", summary="Speak a screen prompt aloud (for phones with no Tamil voice). Returns WAV; prompts only, never student data",
             dependencies=[Depends(limit("tts", per_minute=30))])
def tts(req: TtsRequest, _dev: Device = Depends(auth.device)):
    from ..adapters import gemini_tts
    try:
        audio = gemini_tts.speak(req.text, req.lang)
    except gemini.GeminiUnavailable:
        raise HTTPException(503, "Voice is not available right now") from None
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=604800"})
