"""Evidence events. Same rules as packages/engine/src/events.ts (validateEvent); keep them in step."""
from __future__ import annotations

import math
import re
import time
from typing import Any, Literal

from pydantic import BaseModel, Field

EvidenceKind = Literal["self_report", "family_report", "item_response", "task", "aptitude_response",
                       "interest_choice", "work_sample", "rating", "order", "taster"]
KINDS = set(EvidenceKind.__args__)  # type: ignore[attr-defined]
ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


class EvidenceEvent(BaseModel):
    id: str
    student_id: str
    device_id: str
    kind: str
    skill_id: str | None = None
    subskill_id: str | None = None
    item_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    rater_id: str | None = None
    refers_to: str | None = None
    created_at: float


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _level(x) -> bool:
    return not isinstance(x, bool) and x in (1, 2, 3, 4)


def _score(x) -> bool:
    return not isinstance(x, bool) and x in (0, 1, 2)


def validate_event(e: dict, now_ms: float | None = None) -> list[str]:
    now_ms = time.time() * 1000 if now_ms is None else now_ms
    errs: list[str] = []
    p = e.get("payload") or {}
    if not ULID_RE.match(e.get("id") or ""):
        errs.append("id must be a ULID")
    if not e.get("student_id"):
        errs.append("student_id is required")
    if not e.get("device_id"):
        errs.append("device_id is required")
    kind = e.get("kind")
    if kind not in KINDS:
        errs.append(f"unknown kind {kind}")
    if not _num(e.get("created_at")):
        errs.append("created_at must be a number")
    elif e["created_at"] > now_ms + 24 * 3600 * 1000:
        errs.append("created_at is in the future")
    target = e.get("subskill_id") or e.get("skill_id")

    if kind in ("self_report", "family_report"):
        if not target:
            errs.append("needs skill_id or subskill_id")
        if str(p.get("source")) not in ("voice", "tap", "text"):
            errs.append("payload.source must be voice, tap or text")
        if "retracted" in p and not isinstance(p["retracted"], bool):
            errs.append("payload.retracted must be true or false")
    elif kind == "item_response":
        if not e.get("subskill_id") or not e.get("item_id"):
            errs.append("needs subskill_id and item_id")
        if not isinstance(p.get("correct"), bool):
            errs.append("payload.correct must be true or false")
        if not _num(p.get("ms")) or p["ms"] < 0:
            errs.append("payload.ms must be a positive number")
    elif kind == "task":
        if not e.get("subskill_id"):
            errs.append("needs subskill_id")
        if not _num(p.get("score")) or not 0 <= p["score"] <= 1:
            errs.append("payload.score must be 0-1")
    elif kind == "aptitude_response":
        if not e.get("item_id"):
            errs.append("needs item_id")
        if not str(p.get("domain", "")).startswith("apt_"):
            errs.append("payload.domain must be an aptitude id")
        if not isinstance(p.get("correct"), bool):
            errs.append("payload.correct must be true or false")
        if not _num(p.get("ms")):
            errs.append("payload.ms must be a number")
    elif kind == "interest_choice":
        if not isinstance(p.get("card"), str) or not isinstance(p.get("like"), bool):
            errs.append("payload needs card and like")
    elif kind == "work_sample":
        if not e.get("skill_id"):
            errs.append("needs skill_id")
        if not isinstance(p.get("rubric_id"), str):
            errs.append("payload.rubric_id is required")
        if p.get("scorer") not in ("ai", "teacher", "pending"):
            errs.append("payload.scorer must be ai, teacher or pending")
        scores = p.get("scores")
        if p.get("scorer") != "pending" and (not isinstance(scores, dict) or not scores
                                             or not all(_score(v) for v in scores.values())):
            errs.append("payload.scores must map criteria to 0, 1 or 2")
    elif kind == "rating":
        if not e.get("rater_id"):
            errs.append("needs rater_id")
        if e.get("refers_to"):
            if "scores" in p and not all(_score(v) for v in (p["scores"] or {}).values()):
                errs.append("payload.scores must be 0, 1 or 2")
        else:
            if not target:
                errs.append("needs skill_id or subskill_id")
            if not _level(p.get("level")) and p.get("endorse") is not True:
                errs.append("payload.level must be 1-4 (or endorse: true)")
    elif kind == "order":
        if not e.get("skill_id"):
            errs.append("needs skill_id")
        if not _num(p.get("amount_inr")) or p["amount_inr"] < 0:
            errs.append("payload.amount_inr must be a number")
    elif kind == "taster":
        if not e.get("rater_id"):
            errs.append("needs rater_id")
        levels = p.get("levels")
        if not isinstance(levels, dict) or not levels or not all(_level(v) for v in levels.values()):
            errs.append("payload.levels must map sub-skills to 1-4")
    return errs
