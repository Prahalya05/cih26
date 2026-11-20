"""Checks packages/kb for broken links, duplicate ids and missing fields.

Run:  python scripts/validate_kb.py        (exit code 1 if anything is wrong)

Errors fail CI. Warnings (such as Tamil text still to be written) are printed but do not fail.
"""
from __future__ import annotations

import json
from collections import defaultdict
import re
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

    # RPL certification (Recognition of Prior Learning): only qualification packs checked against official
    # NQR / sector skill council documents. Never invent QP codes.
    skill_ids = {s["id"] for s in skills}
    for o in occupations:
        r = o.get("rpl")
        if r is None:
            continue
        label = f"{o['id']}.rpl"
        if not re.fullmatch(r"[A-Z]{3}/Q\d{4}", str(r.get("qp_code", ""))):
            errors.append(f"{label}: qp_code must look like ABC/Q1234")
        if not r.get("qp_name") or not r.get("ssc"):
            errors.append(f"{label}: needs qp_name and ssc")
        lvl = r.get("nsqf_level")
        if lvl is not None and not (isinstance(lvl, (int, float)) and 1 <= lvl <= 8):
            errors.append(f"{label}: nsqf_level must be 1-8 or null")
        if lvl is None and not r.get("note_en"):
            errors.append(f"{label}: an unknown nsqf_level needs a note saying why")
        if not str(r.get("source_url", "")).startswith("https://"):
            errors.append(f"{label}: needs an https source_url")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(r.get("checked", ""))):
            errors.append(f"{label}: needs a checked date (YYYY-MM-DD)")
        subs = r.get("subskills") or []
        if not subs:
            errors.append(f"{label}: needs the sub-skills the qualification assesses")
        for sid in subs:
            if sid not in sub_ids and sid not in skill_ids:
                errors.append(f"{label}: unknown sub-skill {sid}")

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
    check_pathways(errors, warnings, skill_ids, {s["id"] for s in load("schemes.json")})
    return errors, warnings


PATH_SECTORS = {"stem", "vocational", "agri", "creative", "services", "govt", "health", "entrepreneurship"}
RIASEC = set("RIASEC")


def check_pathways(errors: list[str], warnings: list[str], skill_ids: set[str], scheme_ids: set[str]) -> None:
    """Aim High: the route graph, exams, tracks, subjects and the subject question bank."""
    folder = KB / "pathways"
    if not folder.is_dir():
        return
    graph = load("pathways/graph.json")
    exams = load("pathways/exams.json")
    tracks = load("pathways/tracks.json")
    subjects = load("pathways/subjects.json")
    items = load("pathways/items.json")
    both = lambda o: bool((o or {}).get("en")) and bool((o or {}).get("ta"))  # noqa: E731

    node_ids = {n["id"] for n in graph["nodes"]}
    if len(node_ids) != len(graph["nodes"]):
        errors.append("pathways/graph.json: duplicate node id")
    for n in graph["nodes"]:
        if not both(n.get("name")):
            errors.append(f"pathways node {n['id']}: needs an English and a Tamil name")
    exam_ids = {x["id"] for x in exams}
    for x in exams:
        if not both(x.get("when")):
            errors.append(f"pathways exam {x['id']}: 'when' needs English and Tamil")
        if x.get("url") is None:
            warnings.append(f"pathways exam {x['id']}: no official link yet")
    out: dict[str, set[str]] = defaultdict(set)
    for e in graph["edges"]:
        where = f"pathways edge {e.get('from')}->{e.get('to')}"
        if e.get("from") not in node_ids or e.get("to") not in node_ids:
            errors.append(f"{where}: unknown node")
        if not isinstance(e.get("years"), (int, float)) or e["years"] <= 0:
            errors.append(f"{where}: years must be a positive number")
        for x in e.get("exams", []):
            if x not in exam_ids:
                errors.append(f"{where}: unknown exam {x}")
        if "note" in e and not both(e["note"]):
            errors.append(f"{where}: note needs English and Tamil")
        out[e.get("from")].add(e.get("to"))

    def reach(start: str) -> set[str]:
        seen, todo = {start}, [start]
        while todo:
            for nxt in out[todo.pop()]:
                if nxt not in seen:
                    seen.add(nxt)
                    todo.append(nxt)
        return seen

    from_c10 = reach("c10")
    subject_ids = {s["id"] for s in subjects}
    for t in tracks:
        where = f"pathways track {t['id']}"
        if not both(t.get("name")) or not all(both(r) for r in t.get("roles", [])) or not all(both(h) for h in t.get("help", [])):
            errors.append(f"{where}: name, roles and help need English and Tamil")
        if t.get("sector") not in PATH_SECTORS:
            errors.append(f"{where}: unknown sector {t.get('sector')}")
        if not t.get("riasec") or not set(t["riasec"]) <= RIASEC:
            errors.append(f"{where}: riasec must use the letters RIASEC")
        for g in t.get("goals", []):
            if g not in node_ids:
                errors.append(f"{where}: unknown goal node {g}")
        if not any(g in from_c10 for g in t.get("goals", [])):
            errors.append(f"{where}: no route from Class 10 to any goal")
        for s, w in t.get("subjects", {}).items():
            if s not in subject_ids or not isinstance(w, (int, float)) or w <= 0:
                errors.append(f"{where}: bad subject weight {s}={w}")
        for s in t.get("skills", []):
            if s not in skill_ids:
                errors.append(f"{where}: unknown skill {s}")
        for s in t.get("schemes", []):
            if s not in scheme_ids:
                errors.append(f"{where}: unknown scheme {s}")

    topic_subject: dict[str, str] = {}
    for s in subjects:
        ids = {t["id"] for t in s["topics"]}
        for t in s["topics"]:
            topic_subject[t["id"]] = s["id"]
            if not both(t.get("name")) or t.get("hours", 0) <= 0:
                errors.append(f"pathways topic {t['id']}: needs a bilingual name and positive hours")
            for a in t.get("after", []):
                if a not in ids:
                    errors.append(f"pathways topic {t['id']}: prerequisite {a} is not in {s['id']}")
        # Prerequisites must not loop, or the study plan would leave topics out.
        indeg = {t["id"]: len(t.get("after", [])) for t in s["topics"]}
        ready = [k for k, d in indeg.items() if d == 0]
        placed = 0
        while ready:
            cur = ready.pop()
            placed += 1
            for t in s["topics"]:
                if cur in t.get("after", []):
                    indeg[t["id"]] -= 1
                    if indeg[t["id"]] == 0:
                        ready.append(t["id"])
        if placed != len(s["topics"]):
            errors.append(f"pathways subject {s['id']}: topic prerequisites form a loop")

    seen: set[str] = set()
    per_subject: dict[str, int] = defaultdict(int)
    for it in items:
        where = f"pathways/items.json: {it.get('id')}"
        if it.get("id") in seen:
            errors.append(f"{where}: duplicate id")
        seen.add(it.get("id"))
        if topic_subject.get(it.get("topic")) != it.get("subject"):
            errors.append(f"{where}: topic {it.get('topic')} is not in subject {it.get('subject')}")
        if it.get("format") != "choice":
            errors.append(f"{where}: subject questions are multiple choice")
        ids = [o.get("id") for o in it.get("options", [])]
        if len(ids) < 2 or it.get("answer") not in ids or not all(both(o) for o in it.get("options", [])):
            errors.append(f"{where}: needs 2+ bilingual options and an answer among them")
        if not both(it.get("prompt")) or not both(it.get("why")):
            errors.append(f"{where}: prompt and why need English and Tamil")
        if not isinstance(it.get("b"), (int, float)) or not -4 <= it["b"] <= 4 or not 0.2 <= it.get("a", 1) <= 3:
            errors.append(f"{where}: a must be 0.2-3 and b -4 to 4")
        per_subject[it.get("subject")] += 1
    for s in subject_ids:
        if per_subject[s] < 5:
            errors.append(f"pathways subject {s}: needs at least 5 questions (has {per_subject[s]})")


APTITUDES = {"apt_spatial", "apt_numeric", "apt_mechanical"}
ITEM_FORMATS = {"choice", "estimate", "order_steps", "spot_mistake", "voice_scenario", "simulation"}


def check_items(errors: list[str], warnings: list[str], sub_ids: set[str]) -> None:
    folder = KB / "items"
    if not folder.is_dir():
        return
    seen: set[str] = set()
    active: dict[str, int] = defaultdict(int)  # questions still asked (Step 12.4 retires misfits)
    unreviewed = 0
    for path in sorted(folder.glob("*.json")):
        for it in load(f"items/{path.name}"):
            iid = it.get("id", "?")
            where = f"items/{path.name}: {iid}"
            if iid in seen:
                errors.append(f"{where}: duplicate id")
            seen.add(iid)
            if "domain" in it:
                if it["domain"] not in APTITUDES:
                    errors.append(f"{where}: unknown aptitude {it['domain']}")
            elif it.get("subskill") not in sub_ids:
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
                if len(set(json.dumps(o.get("cells")) for o in it.get("options", []) if "cells" in o)) < sum(1 for o in it.get("options", []) if "cells" in o):
                    errors.append(f"{where}: two shape options are the same")
                for o in it.get("options", []):
                    if "cells" not in o and (not o.get("en") or not o.get("ta")):
                        errors.append(f"{where}: option {o.get('id')} needs English and Tamil")
            elif fmt == "estimate":
                if not isinstance(it.get("answer"), (int, float)) or not isinstance(it.get("tolerance", 0), (int, float)):
                    errors.append(f"{where}: needs a numeric answer and tolerance")
            elif fmt == "order_steps":
                ids = [s.get("id") for s in it.get("steps", [])]
                if len(ids) < 3 or sorted(it.get("answer", [])) != sorted(ids):
                    errors.append(f"{where}: needs 3+ steps and an answer listing each step once")
            if "retired" in it and not isinstance(it["retired"], bool):
                errors.append(f"{where}: retired must be true or false")
            if not it.get("retired"):
                active[it.get("subskill") or it.get("domain")] += 1
            if not it.get("reviewed"):
                unreviewed += 1
    for group, n in sorted(active.items()):
        if n < 4:
            warnings.append(f"{group}: only {n} questions still asked (retired ones excluded)")
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
