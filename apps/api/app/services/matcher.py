"""Career matching: transparent hybrid score -> MMR diversity re-rank with sector quota -> what-if unlocks.

score = w_embed*embed_sim + w_skill*skill_overlap + w_riasec*riasec_fit + w_feas*feasibility
If no embedding similarities are supplied, w_embed is redistributed over the other terms.
"""
from __future__ import annotations

import math

from .. import kb
from .fitreach import _cos, mmr_rerank, occ_riasec_vec, student_riasec_vec

WEIGHTS = {"embed": 0.35, "skill": 0.30, "riasec": 0.20, "feas": 0.15}
DEMAND = {"high": 1.0, "medium": 0.7, "low": 0.4}
ADJACENT_CREDIT = 0.5  # partial credit for a skill in the same cluster as one the student has


def _skill_conf(persona: dict) -> dict[str, float]:
    return {s["id"]: float(s.get("confidence", 0.6)) for s in persona.get("skills", [])}


def skill_overlap(occ: dict, conf: dict[str, float]) -> tuple[float, list[str]]:
    all_skills = kb.skills()
    cluster_best: dict[str, float] = {}
    for sid, c in conf.items():
        cl = all_skills.get(sid, {}).get("cluster")
        if cl:
            cluster_best[cl] = max(cluster_best.get(cl, 0.0), c)
    total = sum(s["w"] for s in occ["skills"])
    got, matched = 0.0, []
    for s in occ["skills"]:
        if s["id"] in conf:
            got += s["w"] * conf[s["id"]]
            matched.append(s["id"])
        else:
            cl = all_skills.get(s["id"], {}).get("cluster")
            got += s["w"] * ADJACENT_CREDIT * cluster_best.get(cl, 0.0)
    return (got / total if total else 0.0), matched


def feasibility(occ: dict, education: str) -> float:
    gap = max(0, kb.EDUCATION_ORDER[occ["min_education"]] - kb.EDUCATION_ORDER.get(education, 0))
    return 0.7 * (1.0 / (1 + gap)) + 0.3 * DEMAND.get(occ.get("local_demand_tn", "medium"), 0.7)


def score_all(persona: dict, embed_sims: dict[str, float] | None = None) -> list[dict]:
    w = dict(WEIGHTS)
    if not embed_sims:
        extra = w.pop("embed")
        rest = sum(w.values())
        w = {k: v + extra * v / rest for k, v in w.items()}
    conf = _skill_conf(persona)
    svec = student_riasec_vec(persona)
    edu = persona.get("education", "class10")
    out = []
    for occ in kb.occupations().values():
        sk, matched = skill_overlap(occ, conf)
        parts = {
            "skill": sk,
            "riasec": _cos(svec, occ_riasec_vec(occ["riasec"])),
            "feas": feasibility(occ, edu),
        }
        if embed_sims:
            parts["embed"] = float(embed_sims.get(occ["id"], 0.0))
        total = sum(w[k] * parts[k] for k in parts)
        out.append({"occupation_id": occ["id"], "sector": occ["sector"], "score": round(total, 4),
                    "parts": {k: round(v, 3) for k, v in parts.items()}, "matched_skills": matched})
    out.sort(key=lambda r: r["score"], reverse=True)
    return out


def what_if(persona: dict, k: int = 8, max_levers: int = 4) -> list[dict]:
    """Counterfactual unlocks: which careers enter the top-k if the student adds one skill or one education level."""
    base = {r["occupation_id"] for r in mmr_rerank(score_all(persona), k)}
    levers: list[tuple[str, dict]] = []
    edu = persona.get("education", "class10")
    higher = [e for e, v in sorted(kb.EDUCATION_ORDER.items(), key=lambda x: x[1]) if v > kb.EDUCATION_ORDER.get(edu, 0)]
    if higher:
        levers.append((f"education:{higher[0]}", {**persona, "education": higher[0]}))
        if "class12" in higher and higher[0] != "class12":
            levers.append(("education:class12", {**persona, "education": "class12"}))
    have = {s["id"] for s in persona.get("skills", [])}
    missing: dict[str, float] = {}
    for occ in kb.occupations().values():
        for s in occ["skills"]:
            if s["id"] not in have:
                missing[s["id"]] = missing.get(s["id"], 0) + s["w"]
    for sid, _ in sorted(missing.items(), key=lambda x: -x[1])[:max_levers]:
        levers.append((f"skill:{sid}", {**persona, "skills": [*persona.get("skills", []), {"id": sid, "confidence": 0.7}]}))
    results = []
    for name, hypo in levers:
        new = [r["occupation_id"] for r in mmr_rerank(score_all(hypo), k)]
        unlocks = [o for o in new if o not in base]
        if unlocks:
            results.append({"lever": name, "unlocks": unlocks})
    return results


def recommend(persona: dict, k: int = 8, embed_sims: dict[str, float] | None = None) -> dict:
    ranked = mmr_rerank(score_all(persona, embed_sims), k)
    return {"careers": ranked, "what_if": what_if(persona, k)}
