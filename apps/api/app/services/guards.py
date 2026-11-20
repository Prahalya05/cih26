"""Rule checks on AI output: the AI suggests, these decide what is kept. Same logic as packages/engine/src/interests.ts.

Each check returns (kept, dropped) so the response can show both in the app's decision X-ray.
"""
from __future__ import annotations

import re

from .. import kb

RIASEC = set("RIASEC")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


def check_interests(raw: object, said: str) -> tuple[list[dict], list[dict]]:
    """Keep a letter only if it is R, I, A, S, E or C and its quote really appears in what she said."""
    kept: list[dict] = []
    dropped: list[dict] = []
    text = _norm(said)
    for x in raw if isinstance(raw, list) else []:
        if not isinstance(x, dict):
            continue
        letter = str(x.get("letter", "")).upper()
        evidence = str(x.get("evidence", "")).strip()
        label = f'{letter or "?"} "{evidence[:40]}"'
        if letter not in RIASEC:
            dropped.append({"value": label, "reason": "not a RIASEC letter"})
            continue
        if not evidence or (text and _norm(evidence) not in text):
            dropped.append({"value": label, "reason": "quote not found in what she said"})
            continue
        if any(k["letter"] == letter for k in kept):
            continue
        try:
            strength = min(1.0, max(0.0, float(x.get("strength", 0.6))))
        except (TypeError, ValueError):
            strength = 0.6
        kept.append({"letter": letter, "tag": str(x.get("tag", ""))[:40], "evidence": evidence[:200], "strength": round(strength, 2)})
    return kept, dropped


def check_careers(raw: object, exclude: set[str], limit: int = 5) -> tuple[list[dict], list[dict]]:
    """Keep only catalogue career ids not already shown. The AI never ranks: the app orders them by its formula."""
    kept: list[dict] = []
    dropped: list[dict] = []
    occ = kb.occupations()
    for x in raw if isinstance(raw, list) else []:
        oid = str(x.get("id", "")) if isinstance(x, dict) else ""
        if oid not in occ:
            dropped.append({"value": oid or "?", "reason": "not in the career catalogue"})
        elif oid in exclude:
            dropped.append({"value": oid, "reason": "already in her list"})
        elif all(k["id"] != oid for k in kept) and len(kept) < limit:
            kept.append({"id": oid, "why": str(x.get("why", ""))[:240]})
    return kept, dropped


# Offline / no-AI fallback for interests: the same word list as the phone (packages/engine/src/interests.ts).
WORDS: dict[str, list[str]] = {
    "R": ["repair", "fix", "machine", "motor", "bike", "farm", "field", "tractor", "tools", "build", "wiring", "electric", "drive", "sport", "mechanic",
          "சரிசெய்", "இயந்திர", "வயல்", "விவசாய", "மோட்டார்", "கருவி", "मरम्मत", "ठीक कर", "मोबाइल", "मशीन", "खेत", "खेती", "बाइक", "बिजली"],
    "I": ["science", "experiment", "puzzle", "math", "research", "computer", "coding", "doctor", "nature", "plants",
          "அறிவியல்", "கணிதம்", "புதிர்", "கணினி", "विज्ञान", "गणित", "प्रयोग", "कंप्यूटर"],
    "A": ["draw", "paint", "music", "sing", "dance", "design", "drama", "art", "photo", "video", "craft", "rangoli", "fashion",
          "ஓவிய", "வரை", "பாட்டு", "நடன", "வடிவமை", "கோலம்", "चित्र", "गाना", "संगीत", "नृत्य", "कला", "रंगोली"],
    "S": ["teach", "help", "care", "nurse", "children", "people", "serve", "community", "health",
          "கற்பி", "உதவ", "கவனி", "குழந்தை", "சேவை", "पढ़ा", "मदद", "सेवा", "बच्चों", "देखभाल"],
    "E": ["sell", "shop", "business", "lead", "money", "market", "manage", "customer",
          "விற்", "கடை", "வியாபார", "தொழில்", "தலைமை", "बेच", "दुकान", "व्यापार", "नेता"],
    "C": ["accounts", "arrange", "organise", "organize", "typing", "office", "records", "bank", "data entry",
          "ஒழுங்கு", "தட்டச்சு", "வங்கி", "हिसाब", "दफ्तर", "टाइपिंग", "बैंक"],
}


def interests_from_keywords(text: str) -> list[dict]:
    t = _norm(text)
    if not t:
        return []
    sentences = [s.strip() for s in re.split(r"[.!?।\n]+", text) if s.strip()] or [text.strip()]
    out = []
    for letter, words in WORDS.items():
        hit = next((w for w in words if _norm(w) in t), None)
        if hit:
            ev = next((s for s in sentences if _norm(hit) in _norm(s)), text.strip())
            out.append({"letter": letter, "tag": hit, "evidence": ev[:200], "strength": 0.6})
    return out


def check_personalised(raw: object, shortlist: list[str], quotes: list[str]) -> tuple[dict, list[dict]]:
    """The AI may only re-order the engine's shortlist and must quote her real words.

    order: ids not in the shortlist and repeats are dropped; shortlist ids the AI left out keep their formula order at the end.
    why:   kept only with a quote found in what she said; an empty quote keeps the reason but marks it unquoted.
    """
    dropped: list[dict] = []
    data = raw if isinstance(raw, dict) else {}
    allowed = list(dict.fromkeys(shortlist))
    order: list[str] = []
    for x in data.get("order") or []:
        oid = str(x)
        if oid not in allowed:
            dropped.append({"value": oid or "?", "reason": "not in the formula's shortlist"})
        elif oid not in order:
            order.append(oid)
    missing = [o for o in allowed if o not in order]
    if missing and order:
        dropped.append({"value": ", ".join(missing), "reason": "left out by the AI: kept in formula order at the end"})
    order += missing

    said = [_norm(q) for q in quotes if q and q.strip()]
    whys: dict[str, dict] = {}
    for x in data.get("items") or []:
        if not isinstance(x, dict):
            continue
        oid, why, quote = str(x.get("id", "")), str(x.get("why", "")).strip(), str(x.get("quote", "")).strip()
        if oid not in allowed or oid in whys or not why:
            continue
        if quote and not any(_norm(quote) in s for s in said):
            dropped.append({"value": f'{oid} "{quote[:40]}"', "reason": "quote not found in what she said"})
            continue
        whys[oid] = {"why": why[:280], "quote": quote[:200]}
    return {"order": order, "order_reason": str(data.get("order_reason", "")).strip()[:300], "why": whys}, dropped


BANNED_TOPICS = ["caste", "religion", "phone number", "mobile number", "address", "aadhaar", "income", "salary of your",
                 "சாதி", "மதம்", "முகவரி", "தொலைபேசி எண்", "जाति", "धर्म", "पता", "फ़ोन नंबर", "आधार"]


def check_followup(raw: object) -> tuple[str | None, list[dict]]:
    """Keep the follow-up only if it is one short question that does not ask for personal data."""
    data = raw if isinstance(raw, dict) else {}
    q = re.sub(r"\s+", " ", str(data.get("question", ""))).strip()
    if not q:
        return None, [{"value": "(empty)", "reason": "no question"}]
    low = q.lower()
    hit = next((w for w in BANNED_TOPICS if w in low), None)
    if hit:
        return None, [{"value": q[:60], "reason": f"asks about '{hit}' (personal data)"}]
    if len(q) > 220 or q.count("?") > 2:
        return None, [{"value": q[:60], "reason": "too long or more than one question"}]
    if "?" not in q and "？" not in q:
        q += "?"
    return q, []
