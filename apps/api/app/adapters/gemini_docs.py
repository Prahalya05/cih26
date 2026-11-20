"""Gemini reads documents: a resume (photo or PDF) and a first look at a certificate or ID.

The AI never verifies anything. For a resume it proposes skills with quotes, and the skill-id and quote checks
(services/guards.py style) keep only what is in the catalogue and really written in the document. For a document it
says what kind it looks like and whether the name matches; a teacher still marks it verified. Nothing is stored.
"""
from __future__ import annotations

import base64

from .gemini import GeminiUnavailable, api_key, generate

TIMEOUT = 40.0

RESUME_SYSTEM = (
    "You read a resume or a hand-written CV of a young person in India (Tamil, Hindi or English).\n"
    "First copy all the readable text into `text`. Then list skills: for each, pick a skill id ONLY from the list "
    "given, and quote the exact words from the document that show it (under 15 words). Also list education lines and "
    "work or volunteering experience as written. Never invent anything that is not in the document."
)

RESUME_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "text": {"type": "STRING"},
        "name": {"type": "STRING"},
        "skills": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "id": {"type": "STRING"}, "quote": {"type": "STRING"}}, "required": ["id", "quote"]}},
        "education": {"type": "ARRAY", "items": {"type": "STRING"}},
        "experience": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["text", "skills", "education", "experience"],
}

DOC_SYSTEM = (
    "You take a first look at a photo of an Indian document for a school counsellor. Say which kind it is from the "
    "list, read the person's name as printed, and say if it matches the expected name (allow initials and spelling "
    "variants). For an income certificate also read the yearly family income in rupees if printed. Do NOT read out "
    "or return any ID number (Aadhaar, ration card or account numbers). If unsure, say so."
)

DOC_KIND_LIST = ["resume", "id_proof", "marksheet", "income_certificate", "ration_card_bpl", "community_certificate",
                 "bank_passbook", "scholarship_letter", "photo", "other", "unreadable"]

DOC_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "kind": {"type": "STRING", "enum": DOC_KIND_LIST},
        "name_on_doc": {"type": "STRING"},
        "name_matches": {"type": "BOOLEAN"},
        "income_inr": {"type": "INTEGER"},
        "readable": {"type": "BOOLEAN"},
        "note": {"type": "STRING"},
    },
    "required": ["kind", "name_matches", "readable", "note"],
}


def _call(system: str, parts: list[dict], schema: dict) -> tuple[dict, str]:
    if not api_key():
        raise GeminiUnavailable("GEMINI_API_KEY not set")
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema, "temperature": 0.0},
    }
    return generate(body, timeout=TIMEOUT, env="GEMINI_VISION_MODEL")


def read_resume(data: bytes, mime: str, skills: dict) -> tuple[dict, str]:
    catalogue = "\n".join(f"{sid}: {s['name']['en']}" for sid, s in skills.items())
    return _call(RESUME_SYSTEM, [{"text": f"Skill ids you may use:\n{catalogue}"},
                                 {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}}], RESUME_SCHEMA)


def check_doc(data: bytes, mime: str, expected_kind: str, expected_name: str) -> tuple[dict, str]:
    return _call(DOC_SYSTEM, [{"text": f"Expected kind: {expected_kind}. Expected name: {expected_name}."},
                              {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}}], DOC_SCHEMA)
