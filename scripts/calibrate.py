"""Recalibrate questions from pilot answers (Step 12.4).

For each sub-skill (and aptitude domain) separately:
  1. Fit a Rasch model (discrimination fixed at 1) to everyone's first answer to each question, by joint
     maximum likelihood. Students who got everything right or everything wrong carry no information and are
     left out of the fit.
  2. Put the new difficulties on the old scale (same mean as the current values of the questions fitted),
     then blend 50:50 with the current values (team or Angoff estimates): 60 students is not enough to trust
     the data alone.
  3. Fit statistics (infit and outfit mean-square). Infit above 1.3 means answers are noisier than the
     model expects (guessing, a confusing picture): the question is retired, still scored for old answers but
     never asked again. Infit below 0.7 (the question separates students more sharply than the others) is
     listed for review, not retired: such questions do not harm measurement. Outfit is reported only; with
     adaptive tests and 60 students it swings too much on one or two lucky answers to act on.
  4. Fairness by question: Mantel-Haenszel test by gender and by medium of instruction, matching students on
     their ability estimate (tests are adaptive, so raw scores are not comparable). ETS category C
     (|delta| >= 1.5 and p < 0.05) means the question must be rewritten.

Written in plain Python (no girth/numpy) so it runs anywhere the API runs.

Run:
    python scripts/calibrate.py                      # read answers from the database, print a report
    python scripts/calibrate.py --events pilot.json  # read {"students": [...], "events": [...]} from a file
    python scripts/calibrate.py --write              # also update packages/kb/items/*.json
After --write: python scripts/gen_golden.py, npm test, python -m pytest apps/api/tests, python scripts/simulate.py
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ITEMS_DIR = ROOT / "packages" / "kb" / "items"
sys.path.insert(0, str(ROOT / "apps" / "api"))

FIT_RANGE = (0.7, 1.3)
MIN_RESPONSES = 20       # fewer answers than this: report only, change nothing
MIN_GROUP = 5            # each DIF group needs at least this many answers to the question
BLEND = 0.5              # weight of the pilot estimate
ETS_C = 1.5
CLAMP = 4.0


# ---------- data ----------

def first_answers(events: list[dict]) -> list[tuple[str, str, int]]:
    """(student, item, 1/0) for the first answer each student gave to each question."""
    seen: set[tuple[str, str]] = set()
    out = []
    for e in sorted(events, key=lambda x: (x["created_at"], x["id"])):
        if e.get("kind") not in ("item_response", "aptitude_response") or not e.get("item_id"):
            continue
        correct = (e.get("payload") or {}).get("correct")
        if not isinstance(correct, bool):
            continue
        key = (e["student_id"], e["item_id"])
        if key in seen:
            continue
        seen.add(key)
        out.append((e["student_id"], e["item_id"], int(correct)))
    return out


def group_of(item: dict) -> str:
    return item.get("subskill") or item.get("domain") or "?"


# ---------- Rasch (joint maximum likelihood) ----------

def _p(theta: float, b: float) -> float:
    return 1 / (1 + math.exp(b - theta))


def rasch(resp: list[tuple[str, str, int]], iters: int = 200) -> tuple[dict[str, float], dict[str, float]]:
    """Returns (item difficulty, person ability). Items mean-centred at 0."""
    # Drop people with perfect or zero scores, then items everyone (left) got right or wrong; repeat.
    data = list(resp)
    while True:
        by_p, by_i = defaultdict(list), defaultdict(list)
        for s, i, x in data:
            by_p[s].append(x)
            by_i[i].append(x)
        bad_p = {s for s, xs in by_p.items() if sum(xs) in (0, len(xs))}
        bad_i = {i for i, xs in by_i.items() if sum(xs) in (0, len(xs))}
        if not bad_p and not bad_i:
            break
        data = [r for r in data if r[0] not in bad_p and r[1] not in bad_i]
        if not data:
            return {}, {}
    persons = {s: 0.0 for s, _, _ in data}
    items = {i: 0.0 for _, i, _ in data}
    for _ in range(iters):
        g_p, h_p = defaultdict(float), defaultdict(float)
        g_i, h_i = defaultdict(float), defaultdict(float)
        for s, i, x in data:
            p = _p(persons[s], items[i])
            g_p[s] += x - p
            h_p[s] += p * (1 - p)
            g_i[i] += p - x
            h_i[i] += p * (1 - p)
        change = 0.0
        for s in persons:
            step = max(-1.0, min(1.0, g_p[s] / h_p[s]))
            persons[s] = max(-CLAMP, min(CLAMP, persons[s] + step))
            change = max(change, abs(step))
        for i in items:
            step = max(-1.0, min(1.0, g_i[i] / h_i[i]))
            items[i] = max(-CLAMP, min(CLAMP, items[i] + step))
            change = max(change, abs(step))
        mean = sum(items.values()) / len(items)
        for i in items:
            items[i] -= mean
        for s in persons:
            persons[s] -= mean
        if change < 1e-4:
            break
    # JML overstates spread by about (L-1)/L for L items per person; apply the usual correction.
    lengths = defaultdict(int)
    for s, _, _ in data:
        lengths[s] += 1
    mean_len = sum(lengths.values()) / len(lengths)
    k = (mean_len - 1) / mean_len if mean_len > 1 else 1.0
    return {i: b * k for i, b in items.items()}, persons


def fit_stats(resp, b: dict[str, float], theta: dict[str, float]) -> dict[str, dict]:
    """Infit and outfit mean-square per item."""
    acc = defaultdict(lambda: {"z2": 0.0, "n": 0, "res2": 0.0, "var": 0.0})
    for s, i, x in resp:
        if i not in b or s not in theta:
            continue
        p = _p(theta[s], b[i])
        v = p * (1 - p)
        a = acc[i]
        a["z2"] += (x - p) ** 2 / v
        a["res2"] += (x - p) ** 2
        a["var"] += v
        a["n"] += 1
    return {i: {"outfit": a["z2"] / a["n"], "infit": a["res2"] / a["var"], "n": a["n"]} for i, a in acc.items()}


# ---------- Mantel-Haenszel DIF ----------

def mantel_haenszel(resp, theta: dict[str, float], group: dict[str, str], focal: str, reference: str,
                    strata: int = 4) -> dict[str, dict]:
    """Per item: MH delta (negative = harder for the focal group), chi-square p, ETS category."""
    people = sorted((t, s) for s, t in theta.items() if group.get(s) in (focal, reference))
    if not people:
        return {}
    cut = {s: min(strata - 1, k * strata // len(people)) for k, (_, s) in enumerate(people)}
    tables = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0]))  # item -> stratum -> [Rr, Rw, Fr, Fw]
    for s, i, x in resp:
        if s not in cut:
            continue
        t = tables[i][cut[s]]
        off = 0 if group[s] == reference else 2
        t[off + (0 if x else 1)] += 1
    out = {}
    for i, by in tables.items():
        n_ref = sum(t[0] + t[1] for t in by.values())
        n_foc = sum(t[2] + t[3] for t in by.values())
        if n_ref < MIN_GROUP or n_foc < MIN_GROUP:
            continue
        num = den = a_sum = e_sum = v_sum = 0.0
        for a, bb, c, d in by.values():
            n = a + bb + c + d
            if n < 2:
                continue
            num += a * d / n
            den += bb * c / n
            m1, m0, nr, nf = a + c, bb + d, a + bb, c + d
            a_sum += a
            e_sum += nr * m1 / n
            v_sum += nr * nf * m1 * m0 / (n * n * (n - 1))
        if num == 0 or den == 0 or v_sum == 0:
            continue
        delta = -2.35 * math.log(num / den)
        chi = (abs(a_sum - e_sum) - 0.5) ** 2 / v_sum
        p = math.erfc(math.sqrt(chi / 2))
        cat = "C" if abs(delta) >= ETS_C and p < 0.05 else "B" if abs(delta) >= 1.0 and p < 0.05 else "A"
        out[i] = {"delta": round(delta, 2), "p": round(p, 4), "ets": cat, "n_ref": n_ref, "n_focal": n_foc}
    return out


# ---------- the whole run ----------

def calibrate(events: list[dict], students: list[dict], bank: dict[str, dict]) -> dict:
    resp = [r for r in first_answers(events) if r[1] in bank]
    gender = {s["id"]: s.get("gender") for s in students}
    medium = {s["id"]: s.get("medium") for s in students}
    by_group = defaultdict(list)
    for r in resp:
        by_group[group_of(bank[r[1]])].append(r)
    report: dict = {"responses": len(resp), "students": len({r[0] for r in resp}), "groups": {}, "items": {}}
    for g, rs in sorted(by_group.items()):
        b, theta = rasch(rs)
        report["groups"][g] = {"responses": len(rs), "items_fitted": len(b), "students_fitted": len(theta)}
        if not b:
            continue
        old_mean = sum(bank[i]["b"] for i in b) / len(b)
        fits = fit_stats(rs, b, theta)
        dif_g = mantel_haenszel(rs, theta, gender, "female", "male")
        dif_m = mantel_haenszel(rs, theta, medium, "tamil", "english")
        counts = defaultdict(int)
        for _, i, _ in rs:
            counts[i] += 1
        for i in sorted(b):
            est = b[i] + old_mean
            enough = counts[i] >= MIN_RESPONSES
            f = fits.get(i, {})
            misfit = enough and f.get("infit", 1) > FIT_RANGE[1]
            overfit = enough and f.get("infit", 1) < FIT_RANGE[0]
            flags = [x for x, d in (("gender", dif_g.get(i)), ("medium", dif_m.get(i))) if d and d["ets"] == "C"]
            report["items"][i] = {
                "group": g, "n": counts[i], "b_old": bank[i]["b"], "b_pilot": round(est, 2),
                "b_new": round((1 - BLEND) * bank[i]["b"] + BLEND * est, 2) if enough else bank[i]["b"],
                "infit": round(f.get("infit", float("nan")), 2), "outfit": round(f.get("outfit", float("nan")), 2),
                "dif_gender": dif_g.get(i), "dif_medium": dif_m.get(i),
                "retire": misfit, "review": overfit, "rewrite": flags, "changed": enough,
            }
    return report


def write_bank(report: dict) -> int:
    """Updates b (and retires misfitting questions) in place, keeping one question per line."""
    changed = 0
    for path in sorted(ITEMS_DIR.glob("*.json")):
        lines = path.read_text(encoding="utf-8").split("\n")
        for k, line in enumerate(lines):
            m = re.search(r'"id": "([^"]+)"', line)
            r = report["items"].get(m.group(1)) if m else None
            if not r or not r["changed"]:
                continue
            line = re.sub(r'"b": -?[\d.]+', f'"b": {r["b_new"]}', line, count=1)
            line = re.sub(r'"b_source": "[^"]*"', '"b_source": "pilot_rasch"', line, count=1)
            if r["retire"] and '"retired": true' not in line:
                line = re.sub(r"\}(,?)\s*$", r', "retired": true}\1', line)
            lines[k] = line
            changed += 1
        json.loads("\n".join(lines))  # still valid JSON
        path.write_text("\n".join(lines), encoding="utf-8", newline="")
    return changed


def to_markdown(report: dict) -> str:
    rows = [f"Calibration from {report['responses']} answers by {report['students']} students.", "",
            "| Question | Group | Answers | Old b | Pilot b | New b | Infit | Outfit | Action |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for i, r in report["items"].items():
        action = []
        if r["retire"]:
            action.append("retire (noisy answers)")
        if r.get("review"):
            action.append("review (unusually sharp)")
        if r["rewrite"]:
            action.append("rewrite (unfair by " + ", ".join(r["rewrite"]) + ")")
        if not r["changed"]:
            action.append(f"too few answers (< {MIN_RESPONSES})")
        rows.append(f"| {i} | {r['group']} | {r['n']} | {r['b_old']} | {r['b_pilot']} | {r['b_new']} | "
                    f"{r['infit']} | {r['outfit']} | {'; '.join(action) or 'ok'} |")
    return "\n".join(rows) + "\n"


def load_db() -> tuple[list[dict], list[dict]]:
    from app import db
    with db.connect() as con:
        evs = con.execute("select id, student_id, kind, item_id, payload, created_at from evidence_event "
                          "where kind in ('item_response', 'aptitude_response')").fetchall()
        sts = con.execute("select id, gender, medium from student").fetchall()
    return ([{**e, "created_at": e["created_at"].timestamp() * 1000} for e in evs], [dict(s) for s in sts])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", help='JSON file with {"students": [...], "events": [...]}')
    ap.add_argument("--write", action="store_true", help="update packages/kb/items/*.json")
    args = ap.parse_args()
    from app import kb
    if args.events:
        data = json.loads(Path(args.events).read_text(encoding="utf-8"))
        events, students = data["events"], data["students"]
    else:
        events, students = load_db()
    report = calibrate(events, students, kb.items())
    print(to_markdown(report))
    out = ROOT / "docs" / "benchmarks" / "calibration.json"
    out.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
    if args.write:
        n = write_bank(report)
        print(f"updated {n} questions. Now run: python scripts/gen_golden.py, npm test, pytest, scripts/simulate.py")


if __name__ == "__main__":
    main()
