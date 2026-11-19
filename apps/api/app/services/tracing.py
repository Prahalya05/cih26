"""Evidence events -> a level (1-4) with confidence for every sub-skill, and aptitude abilities.

Same maths as packages/engine/src/tracing.ts (read that file for the explanation); golden tests check
they agree. The server runs this after each sync to fill skill_state for teacher views.
"""
from __future__ import annotations

import math

from .. import kb
from .irt import level_likelihood, prior, update, eap, se

PRIOR = [0.4, 0.3, 0.2, 0.1]
DAY = 86_400_000

EVIDENCE_WEIGHTS = {
    "self_report": 0.5, "family_report": 0.75, "endorse": 2, "item_group": 0.7, "task": 2,
    "work_sample_ai": 3, "work_sample_teacher": 4, "rating_level": 3, "taster": 4,
    "order_unconfirmed": 1, "order_confirmed": 2,
}
MAX_CONFIRMED_ORDERS = 5
HALF_LIFE_SAID = 365
HALF_LIFE_SHOWN = 730
LEARN_PER_WEEK = 0.05
LEARN_MAX = 0.2
SPREAD_HOP1 = 0.5
SPREAD_HOP2 = 0.25
STRONG_CONFIDENCE = 0.8
AI_RATER = "ai_vision"  # AI-scored work samples count as this rater (weight follows its agreement with teachers)
MAX_HISTORY = 20

SAID = [0.1, 0.3, 0.35, 0.25]
ENDORSE = [0.05, 0.25, 0.4, 0.3]
ORDER_UNCONFIRMED = [0.1, 0.3, 0.4, 0.3]
ORDER_GOOD = [0.02, 0.15, 0.5, 0.6]
ORDER_OK = [0.05, 0.25, 0.5, 0.4]
ORDER_POOR = [0.2, 0.4, 0.3, 0.1]
# Tests, tasks and photos cannot tell level 3 from level 4: only paid work shows earning.
TASK_MU = [0.2, 0.5, 0.8, 0.8]
WORK_MU = [0.15, 0.45, 0.8, 0.8]
SCORE_SD = 0.4
LEVEL4_CAP_UNPAID = 0.4


def _gauss(x: float, mus: list[float], sd: float) -> list[float]:
    return [math.exp(-0.5 * ((x - m) / sd) ** 2) for m in mus]


def _peaked(level: int) -> list[float]:
    return [0.6 if k == level - 1 else 0.25 if abs(k - (level - 1)) == 1 else 0.05 for k in range(4)]


def display_level(p: list[float]) -> tuple[int, float]:
    at_least = 0.0
    for L in range(3, -1, -1):
        at_least += p[L]
        if at_least >= 0.5:
            return L + 1, at_least
    return 1, 1.0


def _normalise(p: list[float]) -> list[float]:
    s = p[0] + p[1] + p[2] + p[3]
    return [x / s for x in p]


def _temper(p: list[float], lik: list[float], w: float) -> list[float]:
    return _normalise([x * math.pow(max(lik[L], 1e-12), w) for L, x in enumerate(p)])


def _learn(p: list[float], weeks: float) -> list[float]:
    f = min(LEARN_PER_WEEK * weeks, LEARN_MAX)
    if f <= 0:
        return p
    return [p[0] * (1 - f), p[1] * (1 - f) + p[0] * f, p[2] * (1 - f) + p[1] * f, p[3] + p[2] * f]


def _flatten(lik: list[float]) -> list[float]:
    return [lik[0], lik[1], lik[1], lik[1]]


def _age(at: float, now: float, said: bool) -> float:
    days = max(0, (now - at) / DAY)
    return math.pow(0.5, days / (HALF_LIFE_SAID if said else HALF_LIFE_SHOWN))


def _targets(g: dict, e: dict) -> list[str]:
    if e.get("subskill_id"):
        return [e["subskill_id"]]
    if e.get("skill_id"):
        return list(g["bySkill"].get(e["skill_id"], [])) or [e["skill_id"]]
    return []


def _item_of(e: dict, items: dict | None) -> dict:
    if e.get("item_id") and items and e["item_id"] in items:
        return items[e["item_id"]]
    p = e.get("payload") or {}
    a = p.get("a") if isinstance(p.get("a"), (int, float)) and not isinstance(p.get("a"), bool) else 1
    b = p.get("b") if isinstance(p.get("b"), (int, float)) and not isinstance(p.get("b"), bool) else 0
    return {"id": e.get("item_id") or "?", "a": a, "b": b}


def _cuts(g: dict, unit: str) -> list[float]:
    s = g["subskills"].get(unit)
    return s["cuts"] if s else [-1, 0.3, 1.5]


def _sample_scores(g: dict, skill: str, scores: dict, rubric: dict | None) -> list[tuple[list[str], float]]:
    groups: dict[str, list[float]] = {}
    fallback = list(g["bySkill"].get(skill, [])) or [skill]
    for crit, s in scores.items():
        sub = None
        if rubric:
            for c in rubric["criteria"]:
                if c["id"] == crit:
                    sub = c.get("subskill")
                    break
        groups.setdefault(sub or "*", []).append(s)
    out = []
    for key in sorted(groups):
        lst = groups[key]
        total = 0
        for x in lst:
            total += x
        out.append((fallback if key == "*" else [key], total / len(lst) / 2))
    return out


def _pieces(events: list[dict], g: dict, opts: dict) -> list[dict]:
    srt = sorted(events, key=lambda e: (e["created_at"], e["id"]))
    pieces: list[dict] = []
    items, rubrics = opts.get("items"), opts.get("rubrics") or {}

    cancelled: set[str] = set()
    open_taps: dict[str, list[str]] = {}
    for e in srt:
        p = e.get("payload") or {}
        if e["kind"] != "self_report" or p.get("source") != "tap":
            continue
        key = f"{e.get('subskill_id') or e.get('skill_id')}|{p.get('qid', '')}"
        lst = open_taps.setdefault(key, [])
        if p.get("retracted") is True:
            if lst:
                cancelled.add(lst.pop())
            cancelled.add(e["id"])
        else:
            lst.append(e["id"])

    confirmations = {e["refers_to"]: e for e in srt if e["kind"] == "rating" and e.get("refers_to")}
    by_id = {e["id"]: e for e in srt}

    groups: dict[str, list[dict]] = {}
    for e in srt:
        if e["kind"] == "item_response" and e.get("subskill_id"):
            groups.setdefault(f"{e['subskill_id']}|{math.floor(e['created_at'] / DAY)}", []).append(e)
    group_end = {lst[-1]["id"]: key for key, lst in groups.items()}
    confirmed_orders: dict[str, int] = {}

    for e in srt:
        p = e.get("payload") or {}
        base = {"at": e["created_at"], "event_id": e["id"], "kind": e["kind"], "rater": None,
                "paid": False, "undo": None, "spreads": False}
        kind = e["kind"]
        if kind in ("self_report", "family_report"):
            if e["id"] in cancelled:
                continue
            w = EVIDENCE_WEIGHTS["self_report"] if kind == "self_report" else EVIDENCE_WEIGHTS["family_report"]
            pieces.append({**base, "units": _targets(g, e), "lik": SAID, "weight": w, "said": True, "shown": False})
        elif kind == "item_response":
            key = group_end.get(e["id"])
            if not key:
                continue
            unit = e["subskill_id"]
            answers = [(_item_of(x, items), (x.get("payload") or {}).get("correct") is True) for x in groups[key]]
            lik = level_likelihood(answers, _cuts(g, unit))
            pieces.append({**base, "kind": "test", "units": [unit], "lik": [lik[0], lik[1], lik[2], lik[2]],
                           "weight": EVIDENCE_WEIGHTS["item_group"], "said": False, "shown": False, "spreads": True})
        elif kind == "task":
            pieces.append({**base, "units": _targets(g, e), "lik": _gauss(float(p["score"]), TASK_MU, SCORE_SD),
                           "weight": EVIDENCE_WEIGHTS["task"], "said": False, "shown": True})
        elif kind == "work_sample":
            if p.get("scorer") == "pending" or not e.get("skill_id"):
                continue
            rubric = rubrics.get(str(p.get("rubric_id")))
            w = EVIDENCE_WEIGHTS["work_sample_teacher"] if p.get("scorer") == "teacher" else EVIDENCE_WEIGHTS["work_sample_ai"]
            rater = AI_RATER if p.get("scorer") == "ai" else None
            for units, s in _sample_scores(g, e["skill_id"], p["scores"], rubric):
                pieces.append({**base, "units": units, "lik": _gauss(s, WORK_MU, SCORE_SD), "weight": w,
                               "said": False, "shown": True, "rater": rater})
        elif kind == "rating":
            if e.get("refers_to"):
                target = by_id.get(e["refers_to"])
                if not target or confirmations[e["refers_to"]]["id"] != e["id"]:
                    continue
                tp = target.get("payload") or {}
                if target["kind"] == "work_sample" and target.get("skill_id") and p.get("scores"):
                    rubric = rubrics.get(str(tp.get("rubric_id")))
                    before = None if tp.get("scorer") == "pending" else _sample_scores(g, target["skill_id"], tp["scores"], rubric)
                    before_w = EVIDENCE_WEIGHTS["work_sample_teacher"] if tp.get("scorer") == "teacher" else EVIDENCE_WEIGHTS["work_sample_ai"]
                    for units, s in _sample_scores(g, target["skill_id"], p["scores"], rubric):
                        old = next((x for x in (before or []) if ",".join(x[0]) == ",".join(units)), None)
                        pieces.append({**base, "kind": "confirmation", "units": units, "lik": _gauss(s, WORK_MU, SCORE_SD),
                                       "weight": EVIDENCE_WEIGHTS["work_sample_teacher"], "said": False,
                                       "rater": e.get("rater_id"), "shown": True,
                                       "undo": {"lik": _gauss(old[1], WORK_MU, SCORE_SD), "weight": before_w,
                                                "at": target["created_at"],
                                                "rater": AI_RATER if tp.get("scorer") == "ai" else None} if old else None})
                elif target["kind"] == "order" and target.get("skill_id"):
                    units = _targets(g, target)
                    key = ",".join(units)
                    n = confirmed_orders.get(key, 0)
                    good = p.get("quality") is True
                    lik = ORDER_GOOD if good and p.get("rehire") is True else ORDER_OK if good else ORDER_POOR
                    weight = EVIDENCE_WEIGHTS["order_confirmed"] if n < MAX_CONFIRMED_ORDERS else 0
                    confirmed_orders[key] = n + 1
                    pieces.append({**base, "kind": "order_confirmed", "units": units, "lik": lik, "weight": weight,
                                   "said": False, "shown": True, "paid": True,
                                   "undo": {"lik": ORDER_UNCONFIRMED, "weight": EVIDENCE_WEIGHTS["order_unconfirmed"],
                                            "at": target["created_at"]}})
                continue
            units = _targets(g, e)
            level = p.get("level")
            if isinstance(level, int) and not isinstance(level, bool):
                pieces.append({**base, "units": units, "lik": _peaked(level), "weight": EVIDENCE_WEIGHTS["rating_level"],
                               "said": False, "rater": e.get("rater_id"), "shown": True})
            elif p.get("endorse") is True:
                pieces.append({**base, "kind": "endorse", "units": units, "lik": ENDORSE, "weight": EVIDENCE_WEIGHTS["endorse"],
                               "said": False, "rater": e.get("rater_id"), "shown": False})
        elif kind == "taster":
            levels = p["levels"]
            for unit in sorted(levels):
                pieces.append({**base, "units": [unit], "lik": _peaked(levels[unit]), "weight": EVIDENCE_WEIGHTS["taster"],
                               "said": False, "rater": e.get("rater_id"), "shown": True})
        elif kind == "order":
            pieces.append({**base, "units": _targets(g, e), "lik": ORDER_UNCONFIRMED,
                           "weight": EVIDENCE_WEIGHTS["order_unconfirmed"], "said": False, "shown": False})
    return pieces


def _new_unit(uid: str) -> dict:
    return {"id": uid, "p": list(PRIOR), "level": 1, "confidence": 1, "strong": False, "performance": False,
            "paid": False, "n": 0, "last_at": 0, "history": []}


def _finish(u: dict) -> dict:
    p = u["p"]
    if not u["paid"] and p[3] > LEVEL4_CAP_UNPAID:
        p = [p[0], p[1], p[2] + p[3] - LEVEL4_CAP_UNPAID, LEVEL4_CAP_UNPAID]
    level, confidence = display_level(p)
    strong = level >= 3 and p[2] + p[3] >= STRONG_CONFIDENCE and u["performance"]
    return {**u, "p": p, "level": level, "confidence": confidence, "strong": strong, "history": list(u["history"])}


def fold_events(events: list[dict], opts: dict, g: dict | None = None) -> dict:
    """opts: now (ms), items {id: {id, a, b}}, rubrics {id: rubric}, raterWeights {rater_id: w}."""
    g = g or kb.graph()
    units: dict[str, dict] = {}
    rater_weights = opts.get("raterWeights") or {}

    def get(uid: str) -> dict:
        if uid not in units:
            units[uid] = _new_unit(uid)
        return units[uid]

    def rater_w(r):
        return max(0.3, rater_weights.get(r, 1)) if r else 1

    now = opts["now"]
    for piece in _pieces(events, g, opts):
        w = piece["weight"] * _age(piece["at"], now, piece["said"]) * rater_w(piece["rater"])
        for uid in piece["units"]:
            u = get(uid)
            before = _finish(u)
            if u["last_at"] > 0:
                u["p"] = _learn(u["p"], (piece["at"] - u["last_at"]) / (7 * DAY))
            if piece["undo"]:
                wu = piece["undo"]["weight"] * _age(piece["undo"]["at"], now, False) * rater_w(piece["undo"].get("rater"))
                u["p"] = _temper(u["p"], piece["undo"]["lik"], -wu)
            u["p"] = _temper(u["p"], piece["lik"], w)
            u["last_at"] = piece["at"]
            u["n"] += 1
            if piece["shown"]:
                u["performance"] = True
            if piece["paid"]:
                u["paid"] = True
            after = _finish(u)
            u["history"].append({"event_id": piece["event_id"], "kind": piece["kind"], "at": piece["at"],
                                 "level_before": before["level"], "level_after": after["level"],
                                 "confidence_after": after["confidence"]})
            if len(u["history"]) > MAX_HISTORY:
                u["history"].pop(0)

            if not (piece["shown"] or piece["spreads"]) or piece["undo"]:
                continue
            flat = _flatten(piece["lik"])
            hop1 = g["related"].get(uid, [])
            reached = {uid, *(r["id"] for r in hop1)}
            for r in hop1:
                v = get(r["id"])
                v["p"] = _temper(v["p"], flat, w * r["weight"] * SPREAD_HOP1)
            for r in hop1:
                for r2 in g["related"].get(r["id"], []):
                    if r2["id"] in reached:
                        continue
                    v = get(r2["id"])
                    v["p"] = _temper(v["p"], flat, w * r["weight"] * r2["weight"] * SPREAD_HOP2)

    return {"units": {uid: _finish(units[uid]) for uid in sorted(units)}, "aptitude": _fold_aptitude(events, opts)}


def _fold_aptitude(events: list[dict], opts: dict) -> dict:
    posts: dict[str, dict] = {}
    for e in sorted(events, key=lambda e: (e["created_at"], e["id"])):
        if e["kind"] != "aptitude_response":
            continue
        p = e.get("payload") or {}
        d = str(p.get("domain"))
        cur = posts.setdefault(d, {"post": prior(0, 1), "n": 0})
        cur["post"] = update(cur["post"], _item_of(e, opts.get("items")), p.get("correct") is True)
        cur["n"] += 1
    return {d: {"theta": eap(posts[d]["post"]), "se": se(posts[d]["post"]), "n": posts[d]["n"]} for d in sorted(posts)}
