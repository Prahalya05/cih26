"""Offline fallback profile extraction: find skills by matching the student's words against skill aliases.

Used when Gemini is not configured or fails, so the demo never breaks. The PWA has the same logic
(apps/web/src/lib/keywords.ts) for fully offline use.
"""
from __future__ import annotations

import re

from .. import kb


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def extract(text: str) -> list[dict]:
    """Return [{id, confidence, evidence}] for every skill whose alias or name appears in the text."""
    t = _norm(text)
    if not t:
        return []
    sentences = [s.strip() for s in re.split(r"[.!?।\n]+", text) if s.strip()] or [text.strip()]
    found = []
    for sid, skill in kb.skills().items():
        terms = [*skill.get("aliases", []), *skill["name"].values()]
        for term in terms:
            term_n = _norm(term)
            if term_n and term_n in t:
                evidence = next((s for s in sentences if term_n in _norm(s)), text.strip())
                found.append({"id": sid, "confidence": 0.5, "evidence": evidence[:200]})
                break
    return found


def experiences(text: str, skills: list[dict]) -> list[dict]:
    """Fallback: everything found goes under one experience, quoting the whole answer."""
    if not skills or not text.strip():
        return []
    return [{"what": "From the student's answer", "responsibilities": [],
             "skill_ids": [s["id"] for s in skills], "evidence": text.strip()[:200]}]
