"""Runs the Python matcher and eligibility code on many test students and saves the results.

The TypeScript engine test (packages/engine/test/parity.test.ts) must produce exactly the same output.
Run again whenever the Python logic or packages/kb changes:

    python scripts/gen_golden.py
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app import kb  # noqa: E402
from app.services import eligibility, matcher  # noqa: E402

OUT = ROOT / "packages" / "engine" / "test" / "golden.json"

MEENA = {
    "education": "class10",
    "riasec": {"R": 0.5, "I": 0.2, "A": 0.9, "S": 0.4, "E": 0.6, "C": 0.3},
    "skills": [{"id": "sk_stitching", "confidence": 0.9}, {"id": "sk_drawing", "confidence": 0.8},
               {"id": "sk_money_handling", "confidence": 0.6}],
}
MEENA_FACTS = {"age": 16, "gender": "female", "state": "TN", "category": "sc", "current_class": 10,
               "passed_class": 9, "stage": "school", "school_type": "govt", "school_6_to_12": "govt",
               "tamil_medium": True, "family_income_inr": 90000}


def random_persona(rng: random.Random) -> dict:
    skill_ids = list(kb.skills())
    persona: dict = {
        "education": rng.choice(list(kb.EDUCATION_ORDER) + ["unknown"]),
        "riasec": {l: round(rng.random(), rng.choice([1, 2, 3])) for l in "RIASEC" if rng.random() < 0.85},
        "skills": [],
    }
    for sid in rng.sample(skill_ids, rng.randint(0, 6)):
        s: dict = {"id": sid}
        if rng.random() < 0.8:
            s["confidence"] = round(rng.random(), rng.choice([1, 2]))
        persona["skills"].append(s)
    if rng.random() < 0.1:
        persona.pop("education")
    return persona


def random_facts(rng: random.Random) -> dict:
    pool = {
        "age": lambda: rng.randint(12, 27),
        "gender": lambda: rng.choice(["female", "male", "other"]),
        "state": lambda: rng.choice(["TN", "KA", "KL"]),
        "category": lambda: rng.choice(["sc", "st", "obc", "general"]),
        "current_class": lambda: rng.randint(7, 12),
        "passed_class": lambda: rng.randint(7, 12),
        "stage": lambda: rng.choice(["school", "iti", "diploma", "ug", "pg"]),
        "course_type": lambda: rng.choice(["technical", "general"]),
        "school_type": lambda: rng.choice(["govt", "aided", "private", "central"]),
        "school_6_to_12": lambda: rng.choice(["govt", "aided", "private"]),
        "tamil_medium": lambda: rng.random() < 0.6,
        "family_income_inr": lambda: rng.choice([50000, 150000, 250000, 250001, 350000, 800000, 900000]),
        "disability_percent": lambda: rng.choice([0, 30, 40, 75]),
        "year_of_study": lambda: rng.randint(1, 4),
        "lateral_entry": lambda: rng.random() < 0.3,
        "class7_percent": lambda: rng.choice([45, 50, 54, 55, 80]),
        "govt_job_family": lambda: rng.random() < 0.2,
        "full_time_job": lambda: rng.random() < 0.2,
        "studying_full_time": lambda: rng.random() < 0.5,
        "final_year": lambda: rng.random() < 0.5,
        "hazardous_trade": lambda: rng.random() < 0.3,
        "other_girls_in_family_with_pragati": lambda: rng.randint(0, 2),
    }
    return {k: gen() for k, gen in pool.items() if rng.random() < 0.6}


def main() -> None:
    rng = random.Random(2026)
    personas = [MEENA, {}, {"education": "graduate", "skills": [{"id": "sk_coding"}]}]
    personas += [random_persona(rng) for _ in range(60)]
    embed_sims = {oid: round(rng.random(), 3) for oid in kb.occupations()}

    facts_list = [MEENA_FACTS, {}]
    for r in kb.rules().values():
        facts_list += [f["facts"] for f in r.get("fixtures", [])]
    facts_list += [random_facts(rng) for _ in range(200)]

    golden = {
        "recommend": [{"persona": p, "result": matcher.recommend(p)} for p in personas],
        "recommend_embed": [{"persona": p, "embed_sims": embed_sims, "result": matcher.recommend(p, embed_sims=embed_sims)}
                            for p in personas[:10]],
        "eligibility": [{"facts": f, "result": eligibility.evaluate_all(f)} for f in facts_list],
    }
    OUT.write_text(json.dumps(golden, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(personas)} students, {len(facts_list)} fact sets")


if __name__ == "__main__":
    main()
