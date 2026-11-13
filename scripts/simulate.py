"""Synthetic student test bench (Step 4.7).

Makes students with known true levels, simulates the evidence they would produce (self-reports with a
confidence bias, adaptive tests, work samples, paid orders), runs the real pipeline, and measures how well
the true level is recovered.

    python scripts/simulate.py            # 500 students, prints a report and writes docs/benchmarks/
    python scripts/simulate.py --n 200    # quicker

Note: this checks that the pipeline recovers levels from evidence that follows our own assumptions.
It does not replace checking against teachers in the pilot (Step 12.3).
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "scripts"))

from app import kb  # noqa: E402
from app.services import irt, tracing  # noqa: E402
from scenarios import DAY, T0, ulid_at  # noqa: E402

SUBSKILLS = ["ss_stitch_machine", "ss_elec_safety", "ss_money_pricing", "ss_teach_explain", "ss_cook_hygiene"]
BANDS = [(-2.5, -1.0), (-1.0, 0.3), (0.3, 1.5), (1.5, 2.5)]  # matches the default cut-points
CLAIM_BY_LEVEL = [0.15, 0.45, 0.7, 0.85]
SAMPLE_MEAN = [0.15, 0.45, 0.75, 0.85]


def make_bank(rng: random.Random, sub: str) -> list[dict]:
    return [{"id": f"{sub}_q{i:02d}", "a": round(rng.uniform(1.0, 1.5), 2), "b": round(-2 + 4.5 * i / 14, 2),
             "format": ["picture_choice", "order_steps", "spot_mistake"][i % 3]} for i in range(15)]


def simulate_student(rng: random.Random, sid: str, banks: dict, bias: float, with_samples: bool = True) -> tuple[list[dict], dict, dict]:
    """Returns events, true levels, and number of test questions asked per sub-skill."""
    events: list[dict] = []
    truth: dict[str, int] = {}
    asked: dict[str, int] = {}
    n = 0

    def add(day: float, kind: str, **kw):
        nonlocal n
        t = T0 + int(day * DAY) + n
        events.append({"id": ulid_at(t, n), "student_id": sid, "device_id": "sim", "kind": kind,
                       "payload": kw.pop("payload", {}), "created_at": t, **kw})
        n += 1
        return events[-1]["id"]

    for k, sub in enumerate(SUBSKILLS):
        level = rng.choices([1, 2, 3, 4], weights=[0.3, 0.35, 0.25, 0.1])[0]
        truth[sub] = level
        theta = rng.uniform(*BANDS[level - 1])
        cuts = kb.graph()["subskills"][sub]["cuts"]
        skill = kb.graph()["subskills"][sub]["skill"]

        if rng.random() < min(1.0, CLAIM_BY_LEVEL[level - 1] * bias):
            add(k, "self_report", subskill_id=sub, payload={"source": "voice"})

        # Adaptive test
        post, seen, formats = irt.prior(), set(), []
        rand = irt.seeded_random(rng.randrange(2**31))
        bank = banks[sub]
        while not irt.should_stop(post, len(seen), len(bank) - len(seen), cuts):
            item = irt.next_item(post, bank, seen, rand, formats)
            correct = rng.random() < irt.p_correct(theta, item["a"], item["b"])
            post = irt.update(post, item, correct)
            seen.add(item["id"])
            formats.append(item["format"])
            add(k + 1, "item_response", subskill_id=sub, item_id=item["id"], payload={"correct": correct, "ms": 6000})
        asked[sub] = len(seen)

        # Work sample, sometimes, for students who can do at least a little
        if with_samples and level >= 2 and rng.random() < 0.6:
            score = min(1.0, max(0.0, rng.gauss(SAMPLE_MEAN[level - 1], 0.12)))
            raw = round(score * 2 * 3) / 3  # three criteria scored 0-2
            add(k + 7, "task", subskill_id=sub, payload={"score": round(raw / 2, 3)})

        # Paid work
        if level == 4:
            for j in range(rng.randint(2, 5)):
                o = add(k + 10 + j, "order", skill_id=skill, subskill_id=sub, payload={"amount_inr": 300})
                add(k + 11 + j, "rating", subskill_id=sub, rater_id="buyer", refers_to=o,
                    payload={"on_time": True, "quality": True, "rehire": rng.random() < 0.85})
        elif level == 3 and rng.random() < 0.3:
            o = add(k + 10, "order", skill_id=skill, subskill_id=sub, payload={"amount_inr": 200})
            add(k + 11, "rating", subskill_id=sub, rater_id="buyer", refers_to=o,
                payload={"on_time": True, "quality": rng.random() < 0.7, "rehire": False})
    return events, truth, asked


def run(n: int = 500, seed: int = 2026, with_samples: bool = True) -> dict:
    rng = random.Random(seed)
    banks = {s: make_bank(rng, s) for s in SUBSKILLS}
    items = {it["id"]: it for b in banks.values() for it in b}
    exact = within = total = 0
    items_asked: list[int] = []
    confusion = [[0] * 4 for _ in range(4)]
    by_bias = {"under": [0, 0], "accurate": [0, 0], "over": [0, 0]}
    for i in range(n):
        group = rng.choices(["under", "accurate", "over"], weights=[0.35, 0.4, 0.25])[0]
        bias = {"under": 0.5, "accurate": 1.0, "over": 1.5}[group]
        events, truth, asked = simulate_student(rng, f"sim{i}", banks, bias, with_samples)
        now = max(e["created_at"] for e in events)
        units = tracing.fold_events(events, {"now": now, "items": items})["units"]
        items_asked += asked.values()
        for sub, true_level in truth.items():
            got = units[sub]["level"]
            total += 1
            exact += got == true_level
            within += abs(got - true_level) <= 1
            confusion[true_level - 1][got - 1] += 1
            by_bias[group][0] += got == true_level
            by_bias[group][1] += 1
    return {
        "students": n,
        "ratings": total,
        "exact": exact / total,
        "within_one": within / total,
        "mean_items": sum(items_asked) / len(items_asked),
        "max_items": max(items_asked),
        "confusion_true_by_estimated": confusion,
        "exact_by_self_report_bias": {k: (v[0] / v[1] if v[1] else None) for k, v in by_bias.items()},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=500)
    args = ap.parse_args()
    report = run(args.n)
    out = ROOT / "docs" / "benchmarks"
    out.mkdir(parents=True, exist_ok=True)
    (out / "simulation.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
