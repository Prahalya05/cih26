"""Pilot report (Step 12.3): how well Disha's levels agree with teachers, how stable they are, how long it
takes, and what students thought. Writes docs/PILOT_REPORT.md.

Inputs:
  answers and other evidence   from the database after syncing the pilot phones at the school
                               (or --events file.json with {"students": [...], "events": [...]})
  --teacher teacher.csv        paper ratings typed in:  student_id,subskill_id,level   (level 1-4)
  --survey survey.csv          the three questions:     student_id,easy,fun,careers_right   (yes / no / unsure)

Run:
    python scripts/pilot_report.py --teacher teacher.csv --survey survey.csv
    python scripts/pilot_report.py --simulate      # dry run on made-up students -> docs/benchmarks/pilot_dry_run.md

Targets (from the implementation plan): weighted kappa >= 0.6 and within one level >= 80%;
same level on retest >= 75%.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.services import irt, tracing  # noqa: E402
from app.services.raters import weighted_kappa  # noqa: E402

DAY_MS = 86_400_000
RETEST_GAP_DAYS = 3        # answers this long after the first session count as a retest
TARGETS = {"kappa": 0.6, "within_one": 0.8, "retest_same": 0.75}
DAY1_TESTS = 3             # plan: day 1 = onboarding + 3 skill tests; day 2 = games + work samples
TOO_EASY, TOO_HARD = 0.9, 0.1
SLOW_SECONDS = 60


# ---------- pieces ----------

def sessions(events: list[dict]) -> dict[tuple[str, str], list[list[dict]]]:
    """Test answers per (student, sub-skill), split into sessions RETEST_GAP_DAYS apart."""
    by: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for e in events:
        if e.get("kind") == "item_response" and e.get("subskill_id"):
            by[(e["student_id"], e["subskill_id"])].append(e)
    out = {}
    for key, evs in by.items():
        evs.sort(key=lambda x: x["created_at"])
        groups = [[evs[0]]]
        for e in evs[1:]:
            if e["created_at"] - groups[-1][0]["created_at"] >= RETEST_GAP_DAYS * DAY_MS:
                groups.append([])
            groups[-1].append(e)
        out[key] = groups
    return out


def test_level(answers: list[dict], items: dict, cuts) -> int | None:
    post = irt.prior()
    n = 0
    for e in answers:
        it = items.get(e.get("item_id"))
        correct = (e.get("payload") or {}).get("correct")
        if it and isinstance(correct, bool):
            post = irt.update(post, {"a": it.get("a", 1.0), "b": it["b"]}, correct)
            n += 1
    if not n:
        return None
    probs = irt.level_probs(post, cuts)
    return probs.index(max(probs)) + 1


def read_csv(path: str | None) -> list[dict]:
    if not path:
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]


def pct(x: float | None) -> str:
    return "–" if x is None else f"{round(100 * x)}%"


def mark(ok: bool | None) -> str:
    return "–" if ok is None else ("met" if ok else "NOT met")


# ---------- report ----------

def build(events: list[dict], students: list[dict], items: dict, graph: dict, teacher: list[dict],
          survey: list[dict]) -> dict:
    by_student: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        by_student[e["student_id"]].append(e)
    now = max((e["created_at"] for e in events), default=0)
    levels = {sid: tracing.fold_events(evs, {"now": now, "items": items})["units"] for sid, evs in by_student.items()}
    gender = {s["id"]: s.get("gender") or "?" for s in students}

    # Agreement with teachers
    pairs = []
    for row in teacher:
        sid, sub = row.get("student_id"), row.get("subskill_id")
        try:
            t = int(row.get("level", ""))
        except ValueError:
            continue
        u = levels.get(sid, {}).get(sub)
        if u and u["n"] > 0 and 1 <= t <= 4:
            pairs.append((sid, sub, u["level"], t))
    agree = {}
    for name, subset in [("all", pairs), *[(f"gender: {g}", [p for p in pairs if gender.get(p[0]) == g])
                                            for g in sorted({gender.get(p[0]) for p in pairs})]]:
        if subset:
            d, t = [p[2] for p in subset], [p[3] for p in subset]
            agree[name] = {"n": len(subset), "kappa": round(weighted_kappa(d, t), 3),
                           "exact": sum(a == b for a, b in zip(d, t)) / len(subset),
                           "within_one": sum(abs(a - b) <= 1 for a, b in zip(d, t)) / len(subset)}
    by_sub = defaultdict(list)
    for p in pairs:
        by_sub[p[1]].append(p)
    per_sub = {s: {"n": len(ps), "kappa": round(weighted_kappa([p[2] for p in ps], [p[3] for p in ps]), 3),
                   "within_one": sum(abs(p[2] - p[3]) <= 1 for p in ps) / len(ps)} for s, ps in sorted(by_sub.items())}

    # Consistency on retest, and effort
    sess = sessions(events)
    retest = []
    minutes = defaultdict(list)
    for (sid, sub), groups in sess.items():
        cuts = graph["subskills"].get(sub, {}).get("cuts", [-1.0, 0.3, 1.5])
        ms = sum((e.get("payload") or {}).get("ms", 0) for e in groups[0])
        if ms:
            minutes[sub].append(ms / 60000)
        if len(groups) >= 2:
            a, b = test_level(groups[0], items, cuts), test_level(groups[-1], items, cuts)
            if a and b:
                retest.append((a, b))
    tests_done = defaultdict(set)
    for (sid, sub) in sess:
        tests_done[sid].add(sub)
    played = {e["student_id"] for e in events if e.get("kind") == "aptitude_response"}
    sampled = {e["student_id"] for e in events if e.get("kind") in ("work_sample", "task")}
    ids = sorted(by_student)
    day1 = [s for s in ids if len(tests_done[s]) >= DAY1_TESTS]
    day2 = [s for s in ids if s in played and s in sampled]

    # Questions to look at
    stats = defaultdict(lambda: {"n": 0, "right": 0, "ms": []})
    for e in events:
        if e.get("kind") in ("item_response", "aptitude_response") and e.get("item_id"):
            st = stats[e["item_id"]]
            st["n"] += 1
            st["right"] += bool((e.get("payload") or {}).get("correct"))
            if (e.get("payload") or {}).get("ms"):
                st["ms"].append(e["payload"]["ms"])
    fix = []
    for iid, st in sorted(stats.items()):
        if st["n"] < 10:
            continue
        p = st["right"] / st["n"]
        why = []
        if p >= TOO_EASY:
            why.append(f"too easy ({pct(p)} right)")
        if p <= TOO_HARD:
            why.append(f"too hard ({pct(p)} right)")
        if st["ms"] and statistics.median(st["ms"]) > SLOW_SECONDS * 1000:
            why.append(f"slow (median {round(statistics.median(st['ms']) / 1000)} s)")
        if why:
            fix.append((iid, "; ".join(why)))
    try:
        import calibrate
        cal = calibrate.calibrate(events, students, items)["items"]
        for iid, r in cal.items():
            if r["retire"]:
                fix.append((iid, f"noisy answers, retire (infit {r['infit']})"))
            if r["rewrite"]:
                fix.append((iid, "may be unfair by " + ", ".join(r["rewrite"])))
    except Exception as exc:  # report still useful without the item analysis
        fix.append(("(item analysis)", f"skipped: {exc}"))

    # Survey
    answers = {}
    for q in ("easy", "fun", "careers_right"):
        vals = [r.get(q, "").lower() for r in survey if r.get(q)]
        answers[q] = {v: vals.count(v) for v in ("yes", "no", "unsure")} | {"n": len(vals)}

    a = agree.get("all")
    retest_same = sum(x == y for x, y in retest) / len(retest) if retest else None
    return {
        "students": len(ids), "teacher_pairs": len(pairs), "agreement": agree, "per_subskill": per_sub,
        "targets": {"kappa": a and a["kappa"] >= TARGETS["kappa"], "within_one": a and a["within_one"] >= TARGETS["within_one"],
                    "retest_same": None if retest_same is None else retest_same >= TARGETS["retest_same"]},
        "retest": {"n": len(retest), "same": retest_same, "within_one": (sum(abs(x - y) <= 1 for x, y in retest) / len(retest)) if retest else None},
        "minutes_per_subskill": {s: round(statistics.median(v), 1) for s, v in sorted(minutes.items())},
        "minutes_overall": round(statistics.median([m for v in minutes.values() for m in v]), 1) if minutes else None,
        "finished_day1": len(day1), "finished_day2": len(day2), "survey": answers, "fix": fix,
    }


def to_markdown(r: dict, synthetic: bool) -> str:
    a = r["agreement"].get("all")
    L = []
    if synthetic:
        L += ["> **Dry run on made-up students. These are not pilot results.** Generated by "
              "`python scripts/pilot_report.py --simulate` to check the report works.", ""]
    L += ["# Pilot report", "",
          f"{r['students']} students; {r['teacher_pairs']} sub-skill levels rated by teachers on paper.", "",
          "## Targets", "", "| Measure | Result | Target | |", "| --- | --- | --- | --- |",
          f"| Weighted kappa, Disha vs teacher | {a['kappa'] if a else '–'} | ≥ {TARGETS['kappa']} | {mark(r['targets']['kappa'])} |",
          f"| Within one level of the teacher | {pct(a['within_one']) if a else '–'} | ≥ {pct(TARGETS['within_one'])} | {mark(r['targets']['within_one'])} |",
          f"| Same level on retest ({r['retest']['n']} retests) | {pct(r['retest']['same'])} | ≥ {pct(TARGETS['retest_same'])} | {mark(r['targets']['retest_same'])} |",
          "", "## Agreement by group", "", "| Group | Ratings | Kappa | Exact | Within one |", "| --- | --- | --- | --- | --- |"]
    for g, x in r["agreement"].items():
        L.append(f"| {g} | {x['n']} | {x['kappa']} | {pct(x['exact'])} | {pct(x['within_one'])} |")
    L += ["", "## Agreement by sub-skill", "", "| Sub-skill | Ratings | Kappa | Within one |", "| --- | --- | --- | --- |"]
    for s, x in r["per_subskill"].items():
        L.append(f"| {s} | {x['n']} | {x['kappa']} | {pct(x['within_one'])} |")
    L += ["", "## Effort", "",
          f"- Median minutes per sub-skill test: {r['minutes_overall'] if r['minutes_overall'] is not None else '–'}",
          *[f"  - {s}: {m}" for s, m in r["minutes_per_subskill"].items()],
          f"- Finished day 1 ({DAY1_TESTS} skill tests): {r['finished_day1']} of {r['students']}",
          f"- Finished day 2 (games and a work sample): {r['finished_day2']} of {r['students']}",
          "", "## What students said", "", "| Question | Yes | No | Unsure | Answers |", "| --- | --- | --- | --- | --- |"]
    labels = {"easy": "Was it easy?", "fun": "Was it fun?", "careers_right": "Do the careers feel right?"}
    for q, x in r["survey"].items():
        L.append(f"| {labels[q]} | {x['yes']} | {x['no']} | {x['unsure']} | {x['n']} |")
    L += ["", "## Questions to fix", ""]
    L += [f"- `{i}`: {why}" for i, why in r["fix"]] or ["- None flagged."]
    return "\n".join(L) + "\n"


# ---------- dry run ----------

def simulated_pilot(n: int = 60, seed: int = 12) -> tuple[list[dict], list[dict], dict, list[dict], list[dict]]:
    import simulate
    from scenarios import DAY, T0, ulid_at
    from app import kb
    rng = random.Random(seed)
    banks = {s: simulate.make_bank(rng, s) for s in simulate.SUBSKILLS}
    items = {it["id"]: {**it, "subskill": s} for s, b in banks.items() for it in b}
    events, students, teacher, survey = [], [], [], []
    for i in range(n):
        sid = f"pilot{i:02d}"
        students.append({"id": sid, "gender": "female" if i % 2 else "male", "medium": "tamil" if i % 3 else "english"})
        evs, truth, _ = simulate.simulate_student(rng, sid, banks, rng.choice([0.5, 1.0, 1.5]))
        for e in evs:
            e["id"] = f"{sid}_{e['id']}"
            if e.get("refers_to"):
                e["refers_to"] = f"{sid}_{e['refers_to']}"
            if e["kind"] == "item_response":
                e["payload"]["ms"] = int(rng.uniform(8000, 40000))
        if rng.random() < 0.9:
            evs.append({"id": f"{sid}_apt", "student_id": sid, "kind": "aptitude_response", "item_id": "apt_x",
                        "payload": {"correct": rng.random() < 0.6}, "created_at": T0 + DAY})
        if i < 20:  # retest 20 students on 2 sub-skills a week later
            for k, sub in enumerate(simulate.SUBSKILLS[:2]):
                theta = rng.uniform(*simulate.BANDS[truth[sub] - 1])
                post, seen, rand = irt.prior(), set(), irt.seeded_random(rng.randrange(2**31))
                cuts = kb.graph()["subskills"][sub]["cuts"]
                while not irt.should_stop(post, len(seen), len(banks[sub]) - len(seen), cuts):
                    it = irt.next_item(post, banks[sub], seen, rand, [])
                    ok = rng.random() < irt.p_correct(theta, it["a"], it["b"])
                    post = irt.update(post, it, ok)
                    seen.add(it["id"])
                    t = T0 + 30 * DAY + k * 1000 + len(seen)
                    evs.append({"id": f"{sid}_rt_{ulid_at(t, len(seen))}", "student_id": sid, "kind": "item_response",
                                "subskill_id": sub, "item_id": it["id"], "payload": {"correct": ok, "ms": 15000},
                                "created_at": t})
        events += evs
        for sub, lvl in truth.items():
            noisy = lvl if rng.random() < 0.65 else max(1, min(4, lvl + rng.choice([-1, 1])))
            teacher.append({"student_id": sid, "subskill_id": sub, "level": str(noisy)})
        survey.append({"student_id": sid, **{q: rng.choices(["yes", "no", "unsure"], [0.7, 0.15, 0.15])[0]
                                             for q in ("easy", "fun", "careers_right")}})
    return events, students, items, teacher, survey


def load_db() -> tuple[list[dict], list[dict]]:
    from app import db
    with db.connect() as con:
        evs = con.execute("select id, student_id, kind, skill_id, subskill_id, item_id, payload, rater_id, refers_to, "
                          "created_at from evidence_event").fetchall()
        sts = con.execute("select id, gender, medium from student").fetchall()
    out = []
    for e in evs:
        d = {k: v for k, v in e.items() if v is not None}
        d["created_at"] = e["created_at"].timestamp() * 1000
        out.append(d)
    return out, [dict(s) for s in sts]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events")
    ap.add_argument("--teacher")
    ap.add_argument("--survey")
    ap.add_argument("--simulate", action="store_true")
    ap.add_argument("--out")
    args = ap.parse_args()
    from app import kb
    if args.simulate:
        events, students, items, teacher, survey = simulated_pilot()
        out = Path(args.out or ROOT / "docs" / "benchmarks" / "pilot_dry_run.md")
    else:
        if args.events:
            data = json.loads(Path(args.events).read_text(encoding="utf-8"))
            events, students = data["events"], data["students"]
        else:
            events, students = load_db()
        items, teacher, survey = kb.items(), read_csv(args.teacher), read_csv(args.survey)
        out = Path(args.out or ROOT / "docs" / "PILOT_REPORT.md")
    report = build(events, students, items, kb.graph(), teacher, survey)
    out.write_text(to_markdown(report, args.simulate), encoding="utf-8", newline="\n")
    print(f"wrote {out}")
    print(json.dumps({k: report[k] for k in ("students", "teacher_pairs", "targets", "retest")}, indent=1))


if __name__ == "__main__":
    main()
