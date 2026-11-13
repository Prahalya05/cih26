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
