"""Scores a photo of a student's work against a checklist (rubric) with Gemini.

The AI never decides alone: its scores count as weaker evidence than a teacher's, and the teacher confirms
or corrects them (rating events). It scores only what the photo shows; criteria it cannot see are left
unscored so the student can retake the photo. The image is processed in memory and never stored.
"""
from __future__ import annotations

import base64
import json
import os

import httpx

from .gemini import API, GeminiUnavailable, api_key, unavailable

TIMEOUT = 40.0

SYSTEM = (
    "You score a student's work against a checklist. The student is a teenager in rural Tamil Nadu.\n"
    "Look only at what the photo shows. For each criterion give score 0, 1 or 2 using the descriptions,\n"
    "a reason of 25 words or fewer about the work (never about the person), and cannot_see: true if the\n"
    "photo does not show that part clearly. Never guess. If the photo is not of this kind of work, set\n"
    "cannot_see: true for every criterion."
)

SCHEMA = {
    "type": "OBJECT",
    "properties": {"criteria": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "id": {"type": "STRING"}, "score": {"type": "INTEGER"}, "reason": {"type": "STRING"},
        "cannot_see": {"type": "BOOLEAN"}}, "required": ["id", "score", "reason", "cannot_see"]}}},
    "required": ["criteria"],
}


def _checklist(rubric: dict) -> str:
    lines = [f"Checklist: {rubric['name']['en']}", f"What the photo should show: {rubric['capture']['en']}"]
    for c in rubric["criteria"]:
        lines.append(f"- id={c['id']}: {c['name']['en']}. 0 = {c['scores']['0']}; 1 = {c['scores']['1']}; 2 = {c['scores']['2']}")
    return "\n".join(lines)


def score(rubric: dict, image: bytes, mime_type: str = "image/jpeg") -> dict:
    """Returns {"scores": {criterion: 0|1|2}, "reasons": {criterion: text}, "cannot_see": [criterion, ...]}."""
    key = api_key()
    if not key:
        raise GeminiUnavailable("GEMINI_API_KEY not set")
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [
            {"text": _checklist(rubric)},
            {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image).decode()}},
        ]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0.0},
    }
    model = os.getenv("GEMINI_VISION_MODEL", os.getenv("GEMINI_MODEL", "gemini-3.5-flash"))
    try:
        r = httpx.post(API.format(model=model), json=body, headers={"x-goog-api-key": key}, timeout=TIMEOUT)
        r.raise_for_status()
        data = json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError) as e:
        raise unavailable(e, model) from e
    return clean(rubric, data)


def clean(rubric: dict, data: dict) -> dict:
    """Keeps only known criteria with valid scores; anything unclear counts as 'cannot see'."""
    known = [c["id"] for c in rubric["criteria"]]
    scores: dict[str, int] = {}
    reasons: dict[str, str] = {}
    for c in data.get("criteria", []):
        cid = c.get("id")
        if cid not in known or cid in scores:
            continue
        reasons[cid] = str(c.get("reason", ""))[:200]
        s = c.get("score")
        if c.get("cannot_see") is not True and isinstance(s, int) and not isinstance(s, bool) and s in (0, 1, 2):
            scores[cid] = s
    return {"scores": scores, "reasons": reasons, "cannot_see": [cid for cid in known if cid not in scores]}
