"""Deterministic eligibility: json-logic rules per scheme. The LLM never decides eligibility.

Mirrored in packages/engine/src/eligibility.ts (the phone runs the same code offline).
"""
from __future__ import annotations

from . import jsonlogic, schemes as catalog

# Next study stages a student could move into; used to show "eligible later" opportunities.
NEXT_STAGES = {"school": ["iti", "diploma", "ug"], "iti": ["diploma"], "diploma": ["ug"], "ug": ["pg"]}
# Joining a stage implies at least this class passed.
STAGE_MIN_PASSED = {"iti": 10, "diploma": 10, "ug": 12, "pg": 15}


def check(scheme_id: str, facts: dict) -> dict:
    rule = catalog.rules()[scheme_id]["rule"]
    ev = jsonlogic.Evaluation()
    result = jsonlogic.apply(rule, facts, ev)
    if result is jsonlogic.UNKNOWN:
        return {"status": "need_info", "missing_facts": sorted(ev.missing)}
    return {"status": "eligible" if result else "not_eligible", "missing_facts": []}


def joined(facts: dict, stage: str, course_type: str) -> dict:
    """The student's facts as they would be in their first year of a new stage."""
    hypo = {k: v for k, v in facts.items() if k not in ("current_class", "final_year", "lateral_entry")}
    hypo.update(stage=stage, course_type=course_type, year_of_study=1)
    passed = facts.get("passed_class")
    hypo["passed_class"] = max(passed if isinstance(passed, (int, float)) else 0, STAGE_MIN_PASSED[stage])
    return hypo


def evaluate_all(facts: dict) -> list[dict]:
    results = []
    rules = catalog.rules()
    for sid, scheme in catalog.schemes().items():
        if sid not in rules:
            continue
        res = check(sid, facts)
        later = None
        if res["status"] != "eligible":
            for stage in NEXT_STAGES.get(facts.get("stage", ""), []):
                for course_type in ("technical", "general"):
                    if check(sid, joined(facts, stage, course_type))["status"] == "eligible":
                        later = {"stage": stage, "course_type": course_type}
                        break
                if later:
                    break
        rule = rules[sid]
        results.append({
            "scheme_id": sid,
            "name": scheme["name"],
            "type": scheme["type"],
            "benefit_en": scheme["benefit_en"],
            "required_documents": scheme["required_documents"],
            "apply_url": scheme["apply_url"],
            "source_url": scheme["source_url"],
            "rule_updated": rule.get("updated"),
            "verified_on": scheme.get("verified_on"),
            **res,
            "eligible_if": later,
        })
    order = {"eligible": 0, "need_info": 1, "not_eligible": 2}
    results.sort(key=lambda r: (order[r["status"]], r["eligible_if"] is None))
    return results
