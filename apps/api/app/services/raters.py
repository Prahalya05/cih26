"""Rater reliability (Step 9.3): how far each teacher, mentor or buyer agrees with the other evidence.

For each rater with enough ratings, each rating is compared with the student's level worked out from
evidence no rater controls (tests, tasks, AI-scored work samples). Two numbers come out:
  leniency  = average (rater's level - level from other evidence); +1 means one level too generous
  agreement = quadratic weighted kappa between the two (1 perfect, 0 no better than chance)
The tracer multiplies a rater's evidence weight by agreement (floor 0.3), so a teacher who rates everyone
level 4 counts for less. Students never see these numbers; facilitators see a gentle note.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .. import kb
from . import tracing

MIN_RATINGS = 10


def _rater_levels(e: dict, by_id: dict) -> list[tuple[str, int]]:
    """(unit, level) pairs this rating claims."""
    p = e.get("payload") or {}
    g = kb.graph()
    if e["kind"] == "taster":
        return [(u, int(v)) for u, v in (p.get("levels") or {}).items()]
    if e["kind"] != "rating":
        return []
    if e.get("refers_to"):
        target = by_id.get(e["refers_to"])
        if not target or target["kind"] != "work_sample" or not p.get("scores"):
            return []
        rubric = kb.rubrics().get(str((target.get("payload") or {}).get("rubric_id")))
        out = []
        for units, s in tracing._sample_scores(g, target["skill_id"], p["scores"], rubric):
            level = 1 + min(3, round(s * 3))  # 0-1 checklist score to levels 1-4
            out += [(u, level) for u in units]
        return out
    if isinstance(p.get("level"), int):
        units = tracing._targets(g, e)
        return [(u, p["level"]) for u in units]
    return []


def weighted_kappa(a: list[int], b: list[int], k: int = 4) -> float:
    n = len(a)
    if n == 0:
        return 0.0
    obs = [[0.0] * k for _ in range(k)]
    for x, y in zip(a, b):
        obs[x - 1][y - 1] += 1 / n
    pa = [sum(row) for row in obs]
    pb = [sum(obs[i][j] for i in range(k)) for j in range(k)]
    num = den = 0.0
    for i in range(k):
        for j in range(k):
            w = ((i - j) ** 2) / ((k - 1) ** 2)
            num += w * obs[i][j]
            den += w * pa[i] * pb[j]
    return 1 - num / den if den > 0 else 0.0


def compute(events_by_student: dict[str, list[dict]], now_ms: float) -> dict[str, dict]:
    """rater id -> {n, leniency, agreement} for raters with at least MIN_RATINGS ratings."""
    pairs: dict[str, list[tuple[int, int]]] = {}
    opts = {"now": now_ms, "items": kb.items(), "rubrics": kb.rubrics()}
    for events in events_by_student.values():
        by_id = {e["id"]: e for e in events}
        raters = sorted({e["rater_id"] for e in events if e.get("rater_id")})
        # Compare with evidence no rater controls (tests, tasks, AI-scored samples), so one lenient
        # rater does not make a fair one look harsh.
        neutral = [e for e in events if not e.get("rater_id")]
        units = tracing.fold_events(neutral, opts)["units"]
        for r in raters:
            mine = [e for e in events if e.get("rater_id") == r]
            for e in mine:
                for unit, level in _rater_levels(e, by_id):
                    u = units.get(unit)
                    if u and u["n"] > 0:  # only where there is other direct evidence to compare with
                        pairs.setdefault(r, []).append((level, u["level"]))
    out = {}
    for r, lst in pairs.items():
        if len(lst) < MIN_RATINGS:
            continue
        mine, theirs = [x for x, _ in lst], [y for _, y in lst]
        out[r] = {"n": len(lst), "leniency": sum(x - y for x, y in lst) / len(lst),
                  "agreement": max(0.0, weighted_kappa(mine, theirs))}
    return out


def update_all(con) -> dict[str, dict]:
    """Recomputes every rater's numbers from the database and stores them in the rater table."""
    from ..routers.v2 import _row_to_event
    rows = con.execute("select * from evidence_event order by student_id, created_at, id").fetchall()
    by_student: dict[str, list[dict]] = {}
    for r in rows:
        by_student.setdefault(r["student_id"], []).append(_row_to_event(r))
    stats = compute(by_student, datetime.now(tz=timezone.utc).timestamp() * 1000)
    for rid, s in stats.items():
        con.execute("update rater set leniency = %s, agreement = %s where id = %s", (s["leniency"], s["agreement"], rid))
    return stats
