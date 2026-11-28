"""Career matching from measured skill levels (version 2): Fit, Reach and Worth.

Same maths as packages/engine/src/fitreach.ts (read that file for the explanation); golden tests check they agree.
"""
from __future__ import annotations

import math

from .. import kb

RIASEC = "RIASEC"
FRW_WEIGHTS = {"fit": 0.4, "reach": 0.35, "worth": 0.25}
REACH_PARTS = {"aptitude": 0.4, "closeness": 0.3, "education": 0.3}
WORTH_PARTS = {"interest": 0.6, "demand": 0.4}
DEMAND = {"high": 1.0, "medium": 0.7, "low": 0.4}
UNKNOWN_LEVELS = [0.5, 0.3, 0.15, 0.05]
UNKNOWN_CREDIT = 0.5  # no evidence at all counts half
MET = 0.6
COULD_LEARN_APTITUDE = 0.65


def _cos(a: list[float], b: list[float]) -> float:
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(x * x for x in b))
    return 0.0 if na == 0 or nb == 0 else sum(x * y for x, y in zip(a, b)) / (na * nb)


def occ_riasec_vec(code: str) -> list[float]:
    weights = [1.0, 0.66, 0.33]
    vec = [0.0] * 6
    for i, letter in enumerate(code[:3]):
        vec[RIASEC.index(letter)] = weights[i]
    return vec


def student_riasec_vec(persona: dict) -> list[float]:
    r = persona.get("riasec") or {}
    return [float(r.get(letter, 0.0)) for letter in RIASEC]


def mmr_rerank(scored: list[dict], k: int = 8, lam: float = 0.7, min_sectors: int = 4) -> list[dict]:
    occs = kb.occupations()
    pool, picked = list(scored), []
    while pool and len(picked) < k:
        sectors = {p["sector"] for p in picked}
        need_new = min_sectors - len(sectors)
        cand = pool
        if need_new > 0 and k - len(picked) <= need_new:
            fresh = [c for c in pool if c["sector"] not in sectors]
            cand = fresh or pool

        def mmr(c: dict) -> float:
            if not picked:
                return c["score"]
            red = max(
                1.0 if p["sector"] == c["sector"] else 0.5 * _cos(
                    occ_riasec_vec(occs[p["occupation_id"]]["riasec"]),
                    occ_riasec_vec(occs[c["occupation_id"]]["riasec"]))
                for p in picked)
            return lam * c["score"] - (1 - lam) * red

        best = max(cand, key=mmr)
        picked.append(best)
        pool.remove(best)
    return picked


def _at_least(p: list[float], level: int) -> float:
    s = 0.0
    for L in range(level - 1, 4):
        s += p[L]
    return s


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def _score_one(occ: dict, persona: dict) -> dict:
    g = kb.graph()
    needs = g["needs"].get(occ["id"], [])
    w_total = sum(n["weight"] for n in needs)
    levels = persona.get("levels") or {}
    fit = 0.0
    shortfall = 0.0
    met: list[str] = []
    gaps: list[tuple[str, float]] = []
    for n in needs:
        known = levels.get(n["id"])
        p = known if known is not None else UNKNOWN_LEVELS
        ok = _at_least(p, n["level"]) * (1 if known is not None else UNKNOWN_CREDIT)
        fit += n["weight"] * ok
        short = 0.0
        for L in range(1, 5):
            short += p[L - 1] * max(0, n["level"] - L)
        shortfall += n["weight"] * (short / 3)
        if ok >= MET:
            met.append(n["id"])
        else:
            gaps.append((n["id"], n["weight"] * (1 - ok)))
    fit = fit / w_total if w_total else 0.0
    closeness = 1 - shortfall / w_total if w_total else 0.0

    apt_needs = g["aptitudeNeeds"].get(occ["id"], [])
    a_total = sum(a["weight"] for a in apt_needs)
    aptitude = persona.get("aptitude") or {}
    apt = 0.0
    apt_known = False
    for a in apt_needs:
        known = aptitude.get(a["id"])
        if known:
            apt_known = True
        apt += a["weight"] * (_sigmoid(1.2 * known["theta"]) if known else 0.5)
    apt = apt / a_total if a_total else 0.5
    edu_gap = max(0, kb.EDUCATION_ORDER[occ["min_education"]] - kb.EDUCATION_ORDER.get(persona.get("education") or "class10", 0))
    education = 1 / (1 + edu_gap)
    reach = REACH_PARTS["aptitude"] * apt + REACH_PARTS["closeness"] * closeness + REACH_PARTS["education"] * education

    interest = _cos(student_riasec_vec(persona), occ_riasec_vec(occ["riasec"]))
    demand = DEMAND.get(occ.get("local_demand_tn") or "medium", 0.7)
    worth = WORTH_PARTS["interest"] * interest + WORTH_PARTS["demand"] * demand

    total = FRW_WEIGHTS["fit"] * fit + FRW_WEIGHTS["reach"] * reach + FRW_WEIGHTS["worth"] * worth
    gaps.sort(key=lambda x: -x[1])
    matched: list[str] = []
    for uid in met:
        sk = kb.skill_of(uid)
        if sk not in matched:
            matched.append(sk)
    return {
        "occupation_id": occ["id"], "sector": occ["sector"], "score": round(total, 4),
        "parts": {"fit": round(fit, 3), "reach": round(reach, 3), "worth": round(worth, 3), "aptitude": round(apt, 3)},
        "matched_skills": matched, "met": met, "gaps": [x[0] for x in gaps],
        "could_learn": apt_known and apt >= COULD_LEARN_APTITUDE and fit < 0.5,
    }


def score_all_v2(persona: dict) -> list[dict]:
    out = [_score_one(occ, persona) for occ in kb.occupations().values()]
    out.sort(key=lambda r: r["score"], reverse=True)
    return out


def what_if_v2(persona: dict, k: int = 8, max_levers: int = 4) -> list[dict]:
    base = {r["occupation_id"] for r in mmr_rerank(score_all_v2(persona), k)}
    levers: list[tuple[str, dict]] = []
    current = kb.EDUCATION_ORDER.get(persona.get("education") or "class10", 0)
    higher = [e for e, v in sorted(kb.EDUCATION_ORDER.items(), key=lambda x: x[1]) if v > current]
    if higher:
        levers.append((f"education:{higher[0]}", {**persona, "education": higher[0]}))
    pull: dict[str, float] = {}
    g = kb.graph()
    for c in score_all_v2(persona):
        if c["occupation_id"] in base:
            continue
        for n in g["needs"].get(c["occupation_id"], []):
            if n["id"] in c["gaps"]:
                pull[n["id"]] = pull.get(n["id"], 0) + n["weight"] * c["score"]
    top = sorted(pull.items(), key=lambda x: (-x[1], x[0]))[:max_levers]
    for uid, _ in top:
        levers.append((f"subskill:{uid}", {**persona, "levels": {**(persona.get("levels") or {}), uid: [0, 0, 1, 0]}}))
    out = []
    for lever, hypo in levers:
        nxt = [r["occupation_id"] for r in mmr_rerank(score_all_v2(hypo), k)]
        unlocks = [o for o in nxt if o not in base]
        if unlocks:
            out.append({"lever": lever, "unlocks": unlocks})
    return out


def recommend_v2(persona: dict, k: int = 8) -> dict:
    return {"careers": mmr_rerank(score_all_v2(persona), k), "what_if": what_if_v2(persona, k)}


def persona_from_profile(profile: dict, education: str | None = None, riasec: dict | None = None) -> dict:
    persona: dict = {"levels": {uid: u["p"] for uid, u in profile["units"].items()}, "aptitude": profile["aptitude"]}
    if education:
        persona["education"] = education
    if riasec:
        persona["riasec"] = riasec
    return persona
