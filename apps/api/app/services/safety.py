"""Child-safety rules (Step 11.3). Keep in step with packages/engine/src/safety.ts."""
from __future__ import annotations

from datetime import datetime, timezone


def is_minor(birth_year: int | None, now: datetime | None = None) -> bool:
    """True unless she is certainly 18 or older (only the birth year is known; unknown counts as under 18)."""
    if not birth_year:
        return True
    now = now or datetime.now(tz=timezone.utc)
    return now.year - birth_year < 19


def safe_rubric(graph: dict, rubric: dict, minor: bool) -> dict | None:
    """For an under-18, drops checklist items on hazardous sub-skills; None when nothing safe is left."""
    if not minor:
        return rubric
    criteria = [c for c in rubric["criteria"]
                if not graph["subskills"].get(c.get("subskill") or "", {}).get("hazardous_under_18")]
    return {**rubric, "criteria": criteria} if criteria else None
