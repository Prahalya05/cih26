"""Scores a short video of a student doing a task against a checklist, step by step, with time stamps.

Like photo scoring (gemini_vision.py): only checklist ids are kept, 0-2 per item, items it cannot see stay
unscored, and the teacher confirms. Added for video: the moment (MM:SS) each item is shown, so the teacher can
jump there, and safety notes with times. Faces are blurred on the phone before upload (MediaPipe), and the video
is processed in memory and never stored. The phone's hand-tracking summary is given as context only.
"""
from __future__ import annotations

import base64
import re


from .gemini import GeminiUnavailable, api_key, generate
from .gemini_vision import _checklist, clean

TIMEOUT = 90.0
MAX_VIDEO_BYTES = 15 * 1024 * 1024  # inline request limit is 20 MB after base64

SYSTEM = (
    "You watch a short video of a teenager in rural Tamil Nadu doing a practical task, and score it against a\n"
    "checklist. Faces are blurred on purpose. Judge only what the hands and the work show.\n"
    "For each criterion: score 0, 1 or 2 using the descriptions; time = the MM:SS moment that best shows it;\n"
    "a reason of 25 words or fewer about the work (never about the person); cannot_see: true if the video does\n"
    "not show it clearly. Never guess. Also list safety concerns you see, each with a time (empty if none).\n"
    "If the video is not of this kind of work, set cannot_see: true for every criterion."
)

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "criteria": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "id": {"type": "STRING"}, "score": {"type": "INTEGER"}, "time": {"type": "STRING"},
            "reason": {"type": "STRING"}, "cannot_see": {"type": "BOOLEAN"}},
            "required": ["id", "score", "time", "reason", "cannot_see"]}},
        "safety": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "time": {"type": "STRING"}, "note": {"type": "STRING"}}, "required": ["time", "note"]}},
    },
    "required": ["criteria", "safety"],
}

TIME = re.compile(r"^\d{1,2}:\d{2}$")


def _process_text(process: dict | None) -> str:
    if not process:
        return "No hand-tracking summary."
    keys = ("seconds", "hands_visible", "two_hands", "steadiness", "active")
    parts = [f"{k}={process[k]}" for k in keys if isinstance(process.get(k), (int, float))]
    return "Hand tracking on the phone (0-1 fractions; context only, do not score from it): " + ", ".join(parts)


def score(rubric: dict, video: bytes, mime_type: str = "video/webm", process: dict | None = None) -> dict:
    key = api_key()
    if not key:
        raise GeminiUnavailable("GEMINI_API_KEY not set")
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [
            {"text": _checklist(rubric).replace("What the photo should show", "What the video should show")},
            {"text": _process_text(process)},
            {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(video).decode()}},
        ]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0.0},
    }
    data, _model = generate(body, timeout=TIMEOUT, env="GEMINI_VISION_MODEL")
    return clean_video(rubric, data)


def clean_video(rubric: dict, data: dict) -> dict:
    """Checklist scores as for photos, plus a valid MM:SS time for each scored item and safety notes."""
    out = clean(rubric, data)
    times: dict[str, str] = {}
    for c in data.get("criteria", []):
        cid, t = c.get("id"), str(c.get("time", ""))
        if cid in out["scores"] and cid not in times and TIME.match(t):
            times[cid] = t
    safety = [{"time": str(s.get("time", ""))[:5], "note": str(s.get("note", ""))[:200]}
              for s in (data.get("safety") or [])[:5] if TIME.match(str(s.get("time", ""))) and s.get("note")]
    return {**out, "times": times, "safety": safety}
