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
from app.services import eligibility, fitreach, irt, matcher, tracing  # noqa: E402

sys.path.insert(0, str(ROOT / "scripts"))
import scenarios  # noqa: E402

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


def seeded_list(seed: int, n: int) -> list[float]:
    r = irt.seeded_random(seed)
    return [r() for _ in range(n)]


def irt_cases() -> dict:
    """Ability scoring, question picking and level conversion on fixed inputs."""
    rand = irt.seeded_random(42)
    bank = [{"id": f"q{i:02d}", "a": round(0.6 + 0.1 * (i % 9), 2), "b": round(-2 + 0.25 * i, 2),
             "format": ["picture_choice", "order_steps", "spot_mistake"][i % 3]} for i in range(17)]
    post = irt.prior()
    picks, formats, seen = [], [], set()
    truth = 0.7
    rng = random.Random(7)
    while not irt.should_stop(post, len(picks), len(bank) - len(seen)):
        item = irt.next_item(post, bank, seen, rand, formats)
        correct = rng.random() < irt.p_correct(truth, item["a"], item["b"])
        post = irt.update(post, item, correct)
        seen.add(item["id"])
        formats.append(item["format"])
        picks.append({"id": item["id"], "correct": correct, "eap": irt.eap(post), "se": irt.se(post)})
    cuts = [-1.0, 0.3, 1.5]
    return {
        "random": seeded_list(7, 5),
        "prior": irt.prior(),
        "bank": bank,
        "session": {"seed": 42, "truth_seed": 7, "truth": truth, "picks": picks, "post": post},
        "level_probs": irt.level_probs(post, cuts),
        "level_likelihood": irt.level_likelihood([(bank[3], True), (bank[8], True), (bank[12], False)], cuts),
        "cuts": cuts,
    }


def fold_cases() -> list[dict]:
    """Skill levels rebuilt from the scenario stories (scripts/scenarios.py), at every checkpoint."""
    cases = []
    events, opts, checkpoints = scenarios.meena()
    for label, n in checkpoints:
        o = {**opts, "now": events[n - 1]["created_at"]}
        cases.append({"name": f"meena_{label}", "events": events[:n], "opts": o, "result": tracing.fold_events(events[:n], o)})
    for name, (ev, o) in (("aptitude", scenarios.aptitude_story()), ("retraction", scenarios.retraction_story())):
        cases.append({"name": name, "events": ev, "opts": o, "result": tracing.fold_events(ev, o)})
    return cases


def recommend_v2_cases(rng: random.Random) -> list[dict]:
    """Fit/Reach/Worth matching on profiles from the stories and on random profiles."""
    personas = []
    events, opts, checkpoints = scenarios.meena()
    for label, n in checkpoints:
        prof = tracing.fold_events(events[:n], {**opts, "now": events[n - 1]["created_at"]})
        personas.append(fitreach.persona_from_profile(prof, "class10", MEENA["riasec"]))
    apt_events, apt_opts = scenarios.aptitude_story()
    personas.append(fitreach.persona_from_profile(tracing.fold_events(apt_events, apt_opts), "class12",
                                                  {"R": 0.8, "I": 0.6}))
    units = list(kb.graph()["subskills"]) + list(kb.skills())
    for _ in range(40):
        levels = {}
        for uid in rng.sample(units, rng.randint(0, 12)):
            raw = [rng.random() for _ in range(4)]
            total = sum(raw)
            levels[uid] = [x / total for x in raw]
        persona = {"levels": levels}
        if rng.random() < 0.6:
            persona["aptitude"] = {a: {"theta": round(rng.uniform(-2, 2), 2), "se": 0.5}
                                   for a in rng.sample(["apt_spatial", "apt_numeric", "apt_mechanical"], rng.randint(1, 3))}
        if rng.random() < 0.8:
            persona["education"] = rng.choice(list(kb.EDUCATION_ORDER) + ["unknown"])
        if rng.random() < 0.8:
            persona["riasec"] = {l: round(rng.random(), 2) for l in "RIASEC" if rng.random() < 0.8}
        personas.append(persona)
    return [{"persona": p, "result": fitreach.recommend_v2(p)} for p in personas]


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
        "irt": irt_cases(),
        "fold": fold_cases(),
        "recommend_v2": recommend_v2_cases(rng),
    }
    OUT.write_text(json.dumps(golden, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(personas)} students, {len(facts_list)} fact sets")


if __name__ == "__main__":
    main()
