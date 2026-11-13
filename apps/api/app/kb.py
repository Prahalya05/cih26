"""Loads the curated knowledge base from packages/kb (read-only, cached)."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

KB_DIR = Path(os.getenv("KB_DIR", Path(__file__).resolve().parents[3] / "packages" / "kb"))

EDUCATION_ORDER = {"none": 0, "class8": 1, "class10": 2, "iti": 3, "class12": 3, "diploma": 4, "graduate": 5}
SECTORS = ["stem", "vocational", "agri", "creative", "services", "govt", "health", "entrepreneurship"]


def _load(name: str):
    with open(KB_DIR / name, encoding="utf-8") as f:
        return json.load(f)


@lru_cache
def skills() -> dict[str, dict]:
    return {s["id"]: s for s in _load("skills.json")}


@lru_cache
def occupations() -> dict[str, dict]:
    return {o["id"]: o for o in _load("occupations.json")}


@lru_cache
def schemes() -> dict[str, dict]:
    return {s["id"]: s for s in _load("schemes.json")}


@lru_cache
def rules() -> dict[str, dict]:
    out = {}
    for p in sorted((KB_DIR / "rules").glob("*.json")):
        with open(p, encoding="utf-8") as f:
            r = json.load(f)
        out[r["id"]] = r
    return out


@lru_cache
def graph() -> dict:
    """Sub-skills, aptitudes and links. Same shape and key order as loadGraph() in packages/engine/src/graph.ts."""
    subskills = _load("graph/subskills.json")
    g: dict = {"subskills": {}, "aptitudes": {}, "bySkill": {}, "needs": {}, "aptitudeNeeds": {}, "related": {}}
    for s in subskills:
        g["subskills"][s["id"]] = s
        g["bySkill"].setdefault(s["skill"], []).append(s["id"])
        g["related"][s["id"]] = []
    for a in _load("graph/aptitudes.json"):
        g["aptitudes"][a["id"]] = a
    for e in _load("graph/edges.json"):
        if e["type"] == "NEEDS":
            g["needs"].setdefault(e["src"], []).append({"id": e["dst"], "level": e.get("level", 2), "weight": e["weight"]})
        elif e["type"] == "NEEDS_APTITUDE":
            g["aptitudeNeeds"].setdefault(e["src"], []).append({"id": e["dst"], "weight": e["weight"]})
        else:
            g["related"][e["src"]].append({"id": e["dst"], "weight": e["weight"]})
            g["related"][e["dst"]].append({"id": e["src"], "weight": e["weight"]})
    return g


def skill_of(subskill_or_skill: str) -> str:
    s = graph()["subskills"].get(subskill_or_skill)
    return s["skill"] if s else subskill_or_skill


@lru_cache
def items() -> dict[str, dict]:
    """Question bank: packages/kb/items/*.json, keyed by id, with a and b for scoring."""
    out: dict[str, dict] = {}
    folder = KB_DIR / "items"
    if folder.is_dir():
        for p in sorted(folder.glob("*.json")):
            with open(p, encoding="utf-8") as f:
                for it in json.load(f):
                    out[it["id"]] = {**it, "a": it.get("a", 1.0), "b": it["b"]}
    return out


@lru_cache
def rubrics() -> dict[str, dict]:
    out: dict[str, dict] = {}
    folder = KB_DIR / "rubrics"
    if folder.is_dir():
        for p in sorted(folder.glob("*.json")):
            with open(p, encoding="utf-8") as f:
                r = json.load(f)
                out[r["id"]] = r
    return out
