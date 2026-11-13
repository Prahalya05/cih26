"""Disha public API, version 1. OpenAPI docs at /docs.

Partners (colleges, NGOs, employers, government systems) can use the same endpoints as the app:
knowledge base, career matching, eligibility checks, and facilitator data.
"""
from __future__ import annotations

import hashlib
import json
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import db, kb
from ..adapters import gemini, keywords
from ..services import eligibility, matcher

router = APIRouter(prefix="/v1")

MAX_AUDIO_BYTES = 2_000_000  # about 60 s of compressed speech


# ---------- knowledge base ----------

@router.get("/kb", summary="The whole knowledge base (careers, skills, schemes, rules)")
def get_kb():
    data = {
        "skills": list(kb.skills().values()),
        "occupations": list(kb.occupations().values()),
        "schemes": list(kb.schemes().values()),
        "rules": list(kb.rules().values()),
    }
    version = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
    return {"version": version, **data}


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

@router.post("/profile/extract", summary="Turn one spoken or typed answer into skills with quoted evidence")
async def extract_profile(
    question: str = Form(...),
    text: str | None = Form(None),
    audio: UploadFile | None = File(None),
):
    audio_bytes = await audio.read() if audio else None
    if audio_bytes and len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Recording too long")
    if not text and not audio_bytes:
        raise HTTPException(422, "Send text or audio")
    # Audio is processed in memory and never stored.
    if gemini.enabled():
        try:
            out = gemini.extract(question, text=text, audio=audio_bytes,
                                 mime_type=(audio.content_type if audio else None) or "audio/webm")
            return {**out, "source": "gemini"}
        except gemini.GeminiUnavailable:
            pass
    if text:
        return {"transcript": text, "skills": keywords.extract(text), "source": "keywords"}
    return {"transcript": "", "skills": [], "source": "unavailable"}


# ---------- offline sync and facilitator ----------

class Action(BaseModel):
    id: str
    student_id: str
    kind: Literal["endorse", "recommend", "feedback", "checkin"]
    payload: dict = {}
    by: str | None = None
    created_at: int | None = None


class SyncRequest(BaseModel):
    students: list[dict] = []
    actions: list[Action] = []
    pull: list[str] = Field([], description="Other student ids on this phone to fetch teacher actions for")


@router.post("/sync", summary="Upload students and actions saved offline; get back actions for those students")
def sync(req: SyncRequest):
    for s in req.students:
        if not isinstance(s.get("id"), str):
            raise HTTPException(422, "Each student needs a string id")
    with db.connect() as con:
        stored = sum(db.upsert_student(con, s) for s in req.students)
        added = sum(db.add_action(con, a.model_dump()) for a in req.actions)
        ids = [s["id"] for s in req.students] + [a.student_id for a in req.actions] + req.pull
        return {"stored_students": stored, "added_actions": added,
                "actions": db.actions_for(con, sorted(set(ids)))}


@router.get("/facilitator/{code}/cohort", summary="All students linked to a facilitator code, with their actions")
def cohort(code: str):
    with db.connect() as con:
        students = db.cohort(con, code)
        return {"students": students, "actions": db.actions_for(con, [s["id"] for s in students])}
