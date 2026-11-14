"""Gemini profile extraction: one call turns a Tamil or English answer (audio or text) into skills.

Experience first: the model also lists what the student actually does ("stitches blouses for neighbours"),
each with its responsibilities, the skill ids it shows and a quote. The flat `skills` list is unchanged,
so the app and evidence events do not depend on `experiences` (method from Tabiya Compass).

The model may only pick skill ids from our skill list, and must quote the student's own words as evidence.
Any skill id it invents is dropped. Eligibility is never decided here.

Config (environment variables):
  GEMINI_API_KEY   required to enable; without it the keyword fallback is used
  GEMINI_MODEL     default "gemini-2.5-flash"
Use a paid-tier key for real students: free-tier inputs may be used by Google to improve its products.
"""
from __future__ import annotations

import base64
import json
import os

import httpx

from .. import kb

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT = 25.0


class GeminiUnavailable(Exception):
    pass


def enabled() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def _prompt(question: str) -> str:
    skills = "\n".join(f"- {sid}: {s['name']['en']} / {s['name'].get('ta', '')}" for sid, s in kb.skills().items())
    return (
        "You are helping a career counsellor for rural students in Tamil Nadu (Class 9 to graduation).\n"
        f"The student was asked: \"{question}\"\n"
        "Their answer is attached (audio or text, usually Tamil, sometimes English or mixed).\n\n"
        "1. Write the transcript in the original language.\n"
        "2. List the skills the answer shows. Use ONLY ids from this list:\n"
        f"{skills}\n"
        "3. For each skill, copy the exact words from the transcript that prove it (evidence) and give a "
        "confidence from 0 to 1. Saying they do something regularly is about 0.7; a passing mention is about 0.4.\n"
        "4. Do not guess skills the student did not mention. An empty list is a valid answer.\n"
        "5. Also list the student's experiences: each thing they actually do (for example \"stitches blouses "
        "for neighbours\" or \"helps father repair motor pumps\"). For each give: what (short, in English), "
        "responsibilities (the tasks they do in it, short English phrases), skill_ids (ids from the list above "
        "that this experience shows) and evidence (the exact words from the transcript). Every skill in step 2 "
        "should belong to at least one experience."
    )


SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "transcript": {"type": "STRING"},
        "skills": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "id": {"type": "STRING"}, "confidence": {"type": "NUMBER"}, "evidence": {"type": "STRING"}},
            "required": ["id", "confidence", "evidence"]}},
        "experiences": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "what": {"type": "STRING"},
            "responsibilities": {"type": "ARRAY", "items": {"type": "STRING"}},
            "skill_ids": {"type": "ARRAY", "items": {"type": "STRING"}},
            "evidence": {"type": "STRING"}},
            "required": ["what", "responsibilities", "skill_ids", "evidence"]}},
    },
    "required": ["transcript", "skills", "experiences"],
}

MAX_EXPERIENCES = 8


def clean_experiences(raw: object, valid: dict) -> list[dict]:
    """Keeps experiences that have a description and a quote; unknown skill ids are dropped."""
    out: list[dict] = []
    for x in raw if isinstance(raw, list) else []:
        if not isinstance(x, dict) or not str(x.get("what", "")).strip() or not str(x.get("evidence", "")).strip():
            continue
        ids = list(dict.fromkeys(i for i in x.get("skill_ids") or [] if isinstance(i, str) and i in valid))
        resp = [str(r).strip()[:120] for r in x.get("responsibilities") or [] if str(r).strip()][:6]
        out.append({"what": str(x["what"]).strip()[:120], "responsibilities": resp, "skill_ids": ids,
                    "evidence": str(x["evidence"]).strip()[:200]})
        if len(out) == MAX_EXPERIENCES:
            break
    return out


def extract(question: str, text: str | None = None, audio: bytes | None = None,
            mime_type: str = "audio/webm") -> dict:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise GeminiUnavailable("GEMINI_API_KEY not set")
    parts: list[dict] = [{"text": _prompt(question)}]
    if audio:
        parts.append({"inline_data": {"mime_type": mime_type, "data": base64.b64encode(audio).decode()}})
    if text:
        parts.append({"text": f"Student's answer (text): {text}"})
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0.1},
    }
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    try:
        r = httpx.post(API.format(model=model), json=body, headers={"x-goog-api-key": key}, timeout=TIMEOUT)
        r.raise_for_status()
        raw = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        data = json.loads(raw)
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError) as e:
        raise GeminiUnavailable(str(e)) from e

    valid = kb.skills()
    skills, seen = [], set()
    for s in data.get("skills", []):
        sid = s.get("id")
        if sid in valid and sid not in seen and s.get("evidence"):
            seen.add(sid)
            conf = min(1.0, max(0.0, float(s.get("confidence", 0.5))))
            skills.append({"id": sid, "confidence": round(conf, 2), "evidence": str(s["evidence"])[:200]})
    return {"transcript": str(data.get("transcript", ""))[:2000], "skills": skills,
            "experiences": clean_experiences(data.get("experiences"), valid)}
