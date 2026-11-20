"""Open-ended Gemini tasks added for the demo round. Each answer is checked by a rule (services/guards.py) before use.

  interests        free speech or text -> RIASEC interests, each with a quote from what she said
  suggest_careers  up to 5 careers she may not have thought of, chosen ONLY from the catalogue (the AI never ranks)

Same config as adapters/gemini.py (GEMINI_API_KEY, GEMINI_MODEL).
"""
from __future__ import annotations

import base64
import json
import time

from .. import kb
from .gemini import generate, models


def model_name() -> str:
    return models()[0]


def _call(parts: list[dict], schema: dict, temperature: float = 0.2) -> tuple[dict, str, int]:
    """One structured call. Returns (json, model, latency ms). Raises GeminiUnavailable."""
    body = {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema, "temperature": temperature}}
    t0 = time.monotonic()
    data, model = generate(body)
    return data, model, int((time.monotonic() - t0) * 1000)


INTEREST_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "transcript": {"type": "STRING"},
        "interests": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "letter": {"type": "STRING"}, "tag": {"type": "STRING"}, "evidence": {"type": "STRING"}, "strength": {"type": "NUMBER"}},
            "required": ["letter", "tag", "evidence", "strength"]}},
    },
    "required": ["transcript", "interests"],
}

INTEREST_PROMPT = (
    "A rural Indian student (Class 9 to graduation) is telling a career counsellor what they enjoy and want in life. "
    "The answer is attached as audio or text, in Tamil, Hindi, English or a mix.\n"
    "1. Write the transcript in the original language and script.\n"
    "2. List their interests as Holland RIASEC letters: R (hands-on, machines, outdoors), I (investigating, science), "
    "A (creating, art, music, design), S (helping, teaching, caring), E (leading, selling, business), "
    "C (organising, records, computers).\n"
    "For each give: letter, a short English tag (for example: repairing motors), evidence = the EXACT words copied "
    "from the transcript, and strength 0-1 (clear liking 0.8, passing mention 0.4).\n"
    "Do not guess interests that were not expressed. An empty list is a valid answer."
)


def interests(text: str | None = None, audio: bytes | None = None, mime_type: str = "audio/webm") -> tuple[dict, str, int]:
    parts: list[dict] = [{"text": INTEREST_PROMPT}]
    if audio:
        parts.append({"inline_data": {"mime_type": mime_type, "data": base64.b64encode(audio).decode()}})
    if text:
        parts.append({"text": f"Student's answer (text): {text}"})
    return _call(parts, INTEREST_SCHEMA)


CAREER_SCHEMA = {
    "type": "OBJECT",
    "properties": {"ideas": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "id": {"type": "STRING"}, "why": {"type": "STRING"}}, "required": ["id", "why"]}}},
    "required": ["ideas"],
}

LANG_NAME = {"ta": "Tamil", "hi": "Hindi", "en": "simple English"}


def suggest_careers(profile: dict, lang: str = "en") -> tuple[dict, str, int]:
    exclude = set(profile.get("exclude") or [])
    catalogue = "\n".join(f"- {oid}: {o['name']['en']} ({o['sector']}, needs {o['min_education']})"
                          for oid, o in kb.occupations().items() if oid not in exclude)
    prompt = (
        "You help a rural Indian student see careers beyond the obvious ones, including non-STEM, vocational and "
        "self-employment options.\n"
        f"Student: interests (RIASEC 0-1) {json.dumps(profile.get('riasec') or {})}; skills {profile.get('skills') or []}; "
        f"education {profile.get('education') or 'unknown'}.\n"
        "Pick up to 5 careers from this catalogue ONLY, using the exact id. Do not rank them.\n"
        f"{catalogue}\n"
        f"For each give a one-sentence reason in {LANG_NAME.get(lang, 'simple English')} that connects it to the student."
    )
    return _call([{"text": prompt}], CAREER_SCHEMA, temperature=0.5)


# ---------- careers tab: personal "why it fits" + order of the top careers ----------

PERSONAL_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "order": {"type": "ARRAY", "items": {"type": "STRING"}},
        "order_reason": {"type": "STRING"},
        "items": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "id": {"type": "STRING"}, "why": {"type": "STRING"}, "quote": {"type": "STRING"}},
            "required": ["id", "why", "quote"]}},
    },
    "required": ["order", "order_reason", "items"],
}


def personalise_careers(shortlist: list[dict], quotes: list[str], riasec: dict, education: str | None,
                        lang: str = "en") -> tuple[dict, str, int]:
    """shortlist: [{id, score, matched_skills}] already allowed and scored by the engine. The AI only orders and explains."""
    occ = kb.occupations()
    lines = "\n".join(f"- {c['id']}: {occ[c['id']]['name']['en']} ({occ[c['id']]['sector']}); formula score {c.get('score', 0):.2f}; "
                      f"matching skills {', '.join(c.get('matched_skills') or []) or 'none'}" for c in shortlist)
    said = "\n".join(f"- \"{q}\"" for q in quotes) or "- (she has not said anything yet)"
    prompt = (
        "You are a careers counsellor for a rural Indian student (Class 9 to graduation). A fixed formula has already "
        "chosen these careers for her; you may not add or remove any.\n"
        f"Careers:\n{lines}\n"
        f"Her interests (RIASEC 0-1): {json.dumps(riasec or {})}. Education: {education or 'unknown'}.\n"
        f"Things she said, word for word:\n{said}\n\n"
        "1. order: the same career ids, best fit for HER first, judging by what she said and enjoys. The formula score is "
        "a strong hint; move a career only when her own words give a clear reason.\n"
        f"2. order_reason: one sentence in English explaining your order.\n"
        f"3. items: for each career, why = one or two short sentences in {LANG_NAME.get(lang, 'simple English')} "
        "speaking to her (\"you\"), and quote = words copied EXACTLY from one of the things she said that support it. "
        "If nothing she said supports a career, use an empty quote. Never invent facts about her."
    )
    return _call([{"text": prompt}], PERSONAL_SCHEMA, temperature=0.4)


# ---------- talk screen: a follow-up question when her answer is vague ----------

FOLLOWUP_SCHEMA = {
    "type": "OBJECT",
    "properties": {"question": {"type": "STRING"}, "aim": {"type": "STRING"}},
    "required": ["question", "aim"],
}


def followup(turns: list[dict], found: list[str], lang: str = "en") -> tuple[dict, str, int]:
    """turns: [{q, said}] so far. found: RIASEC letters already found. Returns one short question in her language."""
    convo = "\n".join(f"Counsellor: {t.get('q') or 'What do you enjoy doing?'}\nStudent: {t.get('said', '')}" for t in turns)
    prompt = (
        "You are a warm careers counsellor talking to a rural Indian student (Class 9 to graduation). Her answers so far "
        "were too short or vague to understand what she enjoys.\n"
        f"{convo}\n"
        f"Interest areas already clear (Holland RIASEC letters): {', '.join(found) or 'none'}.\n"
        f"Ask ONE short, friendly follow-up question in {LANG_NAME.get(lang, 'simple English')} (at most 20 words) that "
        "builds on what she actually said and helps her describe a concrete activity she enjoys (what she does at home, "
        "school, with friends or family). Do not ask about money, caste, religion, phone numbers, address or marks.\n"
        "aim: in English, what you are trying to find out (a few words)."
    )
    return _call([{"text": prompt}], FOLLOWUP_SCHEMA, temperature=0.7)
