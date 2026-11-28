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
LONG_TIMEOUT = 180.0
# Inline requests may be up to 100 MB in all (Gemini API, Jan 2026). Base64 adds a third, so the total sent is kept
# well under that: a short task's video, or a long task's one-picture-a-second video plus its full-speed clips.
MAX_VIDEO_BYTES = 20 * 1024 * 1024
MAX_LONG_VIDEO_BYTES = 55 * 1024 * 1024
MAX_CLIP_BYTES = 6 * 1024 * 1024
MAX_CLIPS = 6
# A long video has one picture a second. Past 30 minutes Gemini is asked to look at fewer of them (about 70 tokens
# each on Gemini 3), so one call stays near 126,000 tokens.
MAX_FRAMES = 1800

SYSTEM = (
    "You watch a short video of a teenager in rural Tamil Nadu doing a practical task, and score it against a\n"
    "checklist. Faces are blurred on purpose. Judge only what the hands and the work show.\n"
    "For each criterion: score 0, 1 or 2 using the descriptions; time = the MM:SS moment that best shows it;\n"
    "a reason of 25 words or fewer about the work (never about the person); cannot_see: true if the video does\n"
    "not show it clearly. Never guess. Also list safety concerns you see, each with a time (empty if none).\n"
    "If the video is not of this kind of work, set cannot_see: true for every criterion.\n"
    "Separately, list in suspicious anything that suggests the work is not her own or not filmed live: a phone or\n"
    "screen playing a video of the work, another person's hands doing the work, cuts or jumps in the video. Each\n"
    "with a time and a note of 20 words or fewer; empty if none. Never lower a checklist score because of these:\n"
    "checklist scores are only about the work."
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
        "suspicious": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "time": {"type": "STRING"}, "note": {"type": "STRING"}}, "required": ["time", "note"]}},
    },
    "required": ["criteria", "safety", "suspicious"],
}

TIME = re.compile(r"^\d{1,2}:\d{2}$")


def _process_text(process: dict | None) -> str:
    if not process:
        return "No hand-tracking summary."
    keys = ("seconds", "hands_visible", "two_hands", "steadiness", "active")
    parts = [f"{k}={process[k]}" for k in keys if isinstance(process.get(k), (int, float))]
    return "Hand tracking on the phone (0-1 fractions; context only, do not score from it): " + ", ".join(parts)


KIND_TEXT = {"screen": "another phone or screen", "multi_face": "another person", "dark": "too dark",
             "no_hands": "no hands seen", "tab_away": "she left the app", "camera_lost": "camera stopped"}


def _moments_text(moments: list[dict] | None) -> str:
    """The moments her phone noticed something, so the AI can look closely there (it still decides what it sees)."""
    items = [f"{KIND_TEXT[m['kind']]} at {int(m['at']) // 60}:{int(m['at']) % 60:02d}"
             for m in (moments or [])[:20] if m.get("kind") in KIND_TEXT and isinstance(m.get("at"), (int, float))]
    if not items:
        return "The phone noticed nothing unusual while filming."
    return "The phone noticed (look closely at these moments; report in suspicious only what you see): " + "; ".join(items)


def _mmss(s: float) -> str:
    return f"{int(s) // 60}:{int(s) % 60:02d}"


def _clips_text(clips: list[dict]) -> str:
    """How the parts of a long task fit together, so times are given in the session's own time."""
    if not clips:
        return ("This is a long task. The video shows the whole session as one picture a second; its MM:SS times are\n"
                "real times in the session.")
    lines = []
    for i, c in enumerate(clips, 1):
        what = "the finished work" if c.get("why") == "final" else "a busy moment"
        lines.append(f"clip {i}: {what}, full speed, starting at {_mmss(c.get('at', 0))} of the session")
    return ("This is a long task. The first video shows the whole session as one picture a second; its MM:SS times are\n"
            "real times in the session. The clips after it are full speed: " + "; ".join(lines) + ".\n"
            "Give every time as the moment in the session (for something only seen in a clip, its start time).")


def score(rubric: dict, video: bytes, mime_type: str = "video/webm", process: dict | None = None,
          moments: list[dict] | None = None, clips: list[tuple[bytes, str, dict]] | None = None) -> dict:
    """clips: None for a short task; for a long task its full-speed clips (maybe none), as
    (bytes, mime type, {"at": seconds, "why": "active" | "final"})."""
    key = api_key()
    if not key:
        raise GeminiUnavailable("GEMINI_API_KEY not set")
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [
            {"text": _checklist(rubric).replace("What the photo should show", "What the video should show")},
            {"text": _process_text(process)},
            {"text": _moments_text(moments)},
            *([{"text": _clips_text([info for _, _, info in clips])}] if clips is not None else []),
            _video_part(video, mime_type, (process or {}).get("seconds") if clips is not None else None),
            *[_video_part(b, m) for b, m, _ in (clips or [])],
        ]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0.0},
    }
    data, _model = generate(body, timeout=LONG_TIMEOUT if clips is not None else TIMEOUT, env="GEMINI_VISION_MODEL")
    return clean_video(rubric, data)


def _video_part(data: bytes, mime_type: str, seconds=None) -> dict:
    """One inline video. A long one-picture-a-second video longer than MAX_FRAMES seconds is sampled more thinly."""
    part: dict = {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(data).decode()}}
    if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and seconds > MAX_FRAMES:
        part["video_metadata"] = {"fps": round(MAX_FRAMES / seconds, 3)}
    return part


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
    suspicious = [{"time": str(s.get("time", ""))[:5], "note": str(s.get("note", ""))[:200]}
                  for s in (data.get("suspicious") or [])[:5] if TIME.match(str(s.get("time", ""))) and s.get("note")]
    return {**out, "times": times, "safety": safety, "suspicious": suspicious}
