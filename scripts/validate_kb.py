"""Checks packages/kb for broken links, duplicate ids and missing fields.

Run:  python scripts/validate_kb.py        (exit code 1 if anything is wrong)

Errors fail CI. Warnings (such as Tamil text still to be written) are printed but do not fail.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

KB = Path(__file__).resolve().parents[1] / "packages" / "kb"
EDGE_TYPES = {"NEEDS", "NEEDS_APTITUDE", "RELATED"}


def load(rel: str):
    with open(KB / rel, encoding="utf-8") as f:
        return json.load(f)


def validate(kb_dir: Path = KB) -> tuple[list[str], list[str]]:
    global KB
    KB = kb_dir
    errors: list[str] = []
    warnings: list[str] = []

    skills = load("skills.json")
    occupations = load("occupations.json")
    subskills = load("graph/subskills.json")
    aptitudes = load("graph/aptitudes.json")
    edges = load("graph/edges.json")

    seen: set[str] = set()
    for kind, rows in (("skill", skills), ("occupation", occupations), ("subskill", subskills), ("aptitude", aptitudes)):
        for r in rows:
            if r["id"] in seen:
                errors.append(f"duplicate id {r['id']} ({kind})")
            seen.add(r["id"])

    skill_ids = {s["id"] for s in skills}
    occ_ids = {o["id"] for o in occupations}
    sub_ids = {s["id"] for s in subskills}
    apt_ids = {a["id"] for a in aptitudes}

    per_skill: dict[str, int] = {}
    for s in subskills:
        sid = s["id"]
        if not sid.startswith("ss_"):
            errors.append(f"{sid}: sub-skill ids start with ss_")
        if s.get("skill") not in skill_ids:
            errors.append(f"{sid}: unknown skill {s.get('skill')}")
        per_skill[s.get("skill")] = per_skill.get(s.get("skill"), 0) + 1
        if not s.get("name", {}).get("en") or not s.get("name", {}).get("ta"):
            errors.append(f"{sid}: needs an English and a Tamil name")
        levels = s.get("levels", {})
        if sorted(levels) != ["1", "2", "3", "4"]:
            errors.append(f"{sid}: needs exactly levels 1-4")
        for n, text in levels.items():
            if not text.get("en"):
                errors.append(f"{sid}: level {n} has no English description")
            if not text.get("ta"):
                warnings.append(f"{sid}: level {n} Tamil description to be written")
        cuts = s.get("cuts", [])
        if len(cuts) != 3 or not (cuts[0] < cuts[1] < cuts[2]):
            errors.append(f"{sid}: cuts must be 3 increasing numbers")
        if not isinstance(s.get("hazardous_under_18"), bool):
            errors.append(f"{sid}: hazardous_under_18 must be true or false")
    for skill, n in per_skill.items():
        if not 3 <= n <= 6:
            errors.append(f"{skill}: has {n} sub-skills, needs 3-6")

    needs_count = {o: 0 for o in occ_ids}
    apt_count = {o: 0 for o in occ_ids}
    related_count = {s: 0 for s in sub_ids}
    keys: set[tuple[str, str, str]] = set()
    for e in edges:
        src, dst, typ, w = e.get("src"), e.get("dst"), e.get("type"), e.get("weight")
        label = f"edge {src} -{typ}-> {dst}"
        if typ not in EDGE_TYPES:
            errors.append(f"{label}: unknown type")
            continue
        key = (src, dst, typ) if typ != "RELATED" else (min(src, dst), max(src, dst), typ)
        if key in keys:
            errors.append(f"{label}: duplicate")
        keys.add(key)
        if not isinstance(w, (int, float)) or not 0 < w <= 1:
            errors.append(f"{label}: weight must be in (0, 1]")
        if not e.get("source"):
            errors.append(f"{label}: needs a source")
        if typ == "NEEDS":
            if src not in occ_ids:
                errors.append(f"{label}: src must be an occupation")
            if dst not in sub_ids and dst not in skill_ids:
                errors.append(f"{label}: dst must be a skill or sub-skill")
            if e.get("level") not in (1, 2, 3, 4):
                errors.append(f"{label}: level must be 1-4")
            needs_count[src] = needs_count.get(src, 0) + 1
        elif typ == "NEEDS_APTITUDE":
            if src not in occ_ids:
                errors.append(f"{label}: src must be an occupation")
            if dst not in apt_ids:
                errors.append(f"{label}: dst must be an aptitude")
            apt_count[src] = apt_count.get(src, 0) + 1
        else:  # RELATED
            if src not in sub_ids or dst not in sub_ids:
                errors.append(f"{label}: both ends must be sub-skills")
            if src == dst:
                errors.append(f"{label}: links to itself")
            if isinstance(w, (int, float)) and w > 0.6:
                errors.append(f"{label}: related weight above 0.6 lets one test raise too much")
            for x in (src, dst):
                if x in related_count:
                    related_count[x] += 1

    for o in occ_ids:
        if needs_count[o] < 3:
            errors.append(f"{o}: needs at least 3 NEEDS edges")
        if apt_count[o] < 1:
            errors.append(f"{o}: needs at least 1 NEEDS_APTITUDE edge")
    for s, n in related_count.items():
        if n == 0:
            errors.append(f"{s}: has no RELATED edge")

    check_items(errors, warnings, sub_ids)
    check_rubrics(errors, skill_ids, sub_ids)
    return errors, warnings


ITEM_FORMATS = {"choice", "estimate", "order_steps", "spot_mistake", "voice_scenario", "simulation"}


def check_items(errors: list[str], warnings: list[str], sub_ids: set[str]) -> None:
    folder = KB / "items"
    if not folder.is_dir():
        return
    seen: set[str] = set()
    unreviewed = 0
    for path in sorted(folder.glob("*.json")):
        for it in load(f"items/{path.name}"):
            iid = it.get("id", "?")
            where = f"items/{path.name}: {iid}"
            if iid in seen:
                errors.append(f"{where}: duplicate id")
            seen.add(iid)
            if it.get("subskill") not in sub_ids:
                errors.append(f"{where}: unknown sub-skill {it.get('subskill')}")
            fmt = it.get("format")
            if fmt not in ITEM_FORMATS:
                errors.append(f"{where}: unknown format {fmt}")
            if not isinstance(it.get("b"), (int, float)) or not -4 <= it["b"] <= 4:
                errors.append(f"{where}: b (difficulty) must be a number from -4 to 4")
            if not isinstance(it.get("a", 1), (int, float)) or not 0.2 <= it.get("a", 1) <= 3:
                errors.append(f"{where}: a (discrimination) must be 0.2-3")
            prompt = it.get("prompt") or {}
            if not prompt.get("en") or not prompt.get("ta"):
                errors.append(f"{where}: prompt needs English and Tamil")
            if fmt == "choice":
                ids = [o.get("id") for o in it.get("options", [])]
                if len(ids) < 2 or it.get("answer") not in ids:
                    errors.append(f"{where}: needs 2+ options and an answer among them")
                for o in it.get("options", []):
                    if not o.get("en") or not o.get("ta"):
                        errors.append(f"{where}: option {o.get('id')} needs English and Tamil")
            elif fmt == "estimate":
                if not isinstance(it.get("answer"), (int, float)) or not isinstance(it.get("tolerance", 0), (int, float)):
                    errors.append(f"{where}: needs a numeric answer and tolerance")
            elif fmt == "order_steps":
                ids = [s.get("id") for s in it.get("steps", [])]
                if len(ids) < 3 or sorted(it.get("answer", [])) != sorted(ids):
                    errors.append(f"{where}: needs 3+ steps and an answer listing each step once")
            if not it.get("reviewed"):
                unreviewed += 1
    if unreviewed:
        warnings.append(f"{unreviewed} questions not yet reviewed by a teacher (Step 5.4)")


def check_rubrics(errors: list[str], skill_ids: set[str], sub_ids: set[str]) -> None:
    folder = KB / "rubrics"
    if not folder.is_dir():
        return
    for path in sorted(folder.glob("*.json")):
        r = load(f"rubrics/{path.name}")
        where = f"rubrics/{path.name}"
        if r.get("skill") not in skill_ids:
            errors.append(f"{where}: unknown skill {r.get('skill')}")
        crit = r.get("criteria", [])
        if not 3 <= len(crit) <= 6:
            errors.append(f"{where}: needs 3-6 criteria")
        for c in crit:
            if c.get("subskill") and c["subskill"] not in sub_ids:
                errors.append(f"{where}: criterion {c.get('id')} has unknown sub-skill")
            if sorted((c.get("scores") or {}).keys()) != ["0", "1", "2"]:
                errors.append(f"{where}: criterion {c.get('id')} needs descriptions for scores 0, 1 and 2")


def main() -> int:
    errors, warnings = validate()
    if warnings:
        print(f"{len(warnings)} warnings (first 5):")
        for w in warnings[:5]:
            print("  warn:", w)
    for e in errors:
        print("  ERROR:", e)
    print("knowledge base OK" if not errors else f"{len(errors)} errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
