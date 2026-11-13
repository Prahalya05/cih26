"""Copies packages/kb into PostgreSQL: graph nodes and edges, question items and checklists.

Run on every deploy, after migrate.py:   python scripts/load_kb.py [database_url]
Running it twice changes nothing. Nodes that disappeared from the files are marked inactive
(other rows may point at them); edges, items and checklists that disappeared are removed or deactivated.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
KB = ROOT / "packages" / "kb"
sys.path.insert(0, str(ROOT / "apps" / "api"))


def _read(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _version() -> str:
    h = hashlib.sha256()
    for p in sorted(KB.rglob("*.json")):
        h.update(p.relative_to(KB).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:12]


def collect() -> dict:
    nodes: list[tuple[str, str, dict]] = []
    for kind, file in (("skill", "skills.json"), ("occupation", "occupations.json"), ("scheme", "schemes.json"),
                       ("subskill", "graph/subskills.json"), ("aptitude", "graph/aptitudes.json")):
        nodes += [(r["id"], kind, r) for r in _read(KB / file)]
    edges = _read(KB / "graph" / "edges.json")
    items = [it for p in sorted((KB / "items").glob("*.json")) for it in _read(p)] if (KB / "items").is_dir() else []
    rubrics = [_read(p) for p in sorted((KB / "rubrics").glob("*.json"))] if (KB / "rubrics").is_dir() else []
    return {"nodes": nodes, "edges": edges, "items": items, "rubrics": rubrics}


def load(url: str, quiet: bool = False) -> dict:
    data = collect()
    version = _version()
    with psycopg.connect(url) as con, con.transaction():
        node_ids = [n[0] for n in data["nodes"]]
        for nid, kind, props in data["nodes"]:
            con.execute(
                "insert into kg_node(id, type, props, version, active) values (%s, %s, %s, %s, true) "
                "on conflict (id) do update set type = excluded.type, props = excluded.props, "
                "version = excluded.version, active = true "
                "where kg_node.props is distinct from excluded.props or not kg_node.active",
                (nid, kind, Jsonb(props), version))
        con.execute("update kg_node set active = false where active and not (id = any(%s))", (node_ids,))

        keys = []
        for e in data["edges"]:
            keys.append(f"{e['src']}|{e['dst']}|{e['type']}")
            con.execute(
                "insert into kg_edge(src, dst, type, weight, level, source, version) values (%s, %s, %s, %s, %s, %s, %s) "
                "on conflict (src, dst, type) do update set weight = excluded.weight, level = excluded.level, "
                "source = excluded.source, version = excluded.version "
                "where (kg_edge.weight, kg_edge.level, kg_edge.source) is distinct from "
                "(excluded.weight, excluded.level, excluded.source)",
                (e["src"], e["dst"], e["type"], e["weight"], e.get("level"), e.get("source"), version))
        con.execute("delete from kg_edge where not (src || '|' || dst || '|' || type = any(%s))", (keys,))

        item_ids = []
        for it in data["items"]:
            item_ids.append(it["id"])
            langs = sorted((it.get("prompt") or {}).keys())
            con.execute(
                "insert into item(id, subskill_id, format, difficulty, discrimination, body, langs, active, version) "
                "values (%s, %s, %s, %s, %s, %s, %s, true, %s) on conflict (id) do update set "
                "subskill_id = excluded.subskill_id, format = excluded.format, difficulty = excluded.difficulty, "
                "discrimination = excluded.discrimination, body = excluded.body, langs = excluded.langs, "
                "active = true, version = excluded.version where item.body is distinct from excluded.body or not item.active",
                (it["id"], it["subskill"], it["format"], it["b"], it.get("a", 1.0), Jsonb(it), langs, version))
        con.execute("update item set active = false where active and not (id = any(%s))", (item_ids,))

        rubric_ids = []
        for rb in data["rubrics"]:
            rubric_ids.append(rb["id"])
            con.execute(
                "insert into rubric(id, skill_id, criteria, version) values (%s, %s, %s, %s) "
                "on conflict (id) do update set skill_id = excluded.skill_id, criteria = excluded.criteria, "
                "version = excluded.version where rubric.criteria is distinct from excluded.criteria",
                (rb["id"], rb["skill"], Jsonb(rb["criteria"]), version))
        con.execute("delete from rubric where not (id = any(%s))", (rubric_ids,))

    counts = {k: len(v) for k, v in data.items()}
    if not quiet:
        print(f"loaded kb {version}: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
    return counts


if __name__ == "__main__":
    if len(sys.argv) > 1:
        db_url = sys.argv[1]
    else:
        from app import settings
        db_url = settings.DATABASE_URL
    load(db_url)
