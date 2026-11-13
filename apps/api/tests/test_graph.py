"""The knowledge graph loads, validates, and matches what the TypeScript engine builds."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "scripts"))

from app import kb  # noqa: E402
import validate_kb  # noqa: E402


def test_kb_is_valid():
    errors, _ = validate_kb.validate()
    assert errors == []


def test_graph_shape():
    g = kb.graph()
    assert len(g["subskills"]) == 32
    assert g["bySkill"]["sk_stitching"] == ["ss_stitch_measure", "ss_stitch_cutting", "ss_stitch_machine", "ss_stitch_fitting"]
    assert {"id": "ss_elec_safety", "level": 3, "weight": 1} in g["needs"]["occ_electrician"]
    for sid, lst in g["related"].items():
        for r in lst:
            assert {"id": sid, "weight": r["weight"]} in g["related"][r["id"]]
    assert kb.skill_of("ss_cook_costing") == "sk_cooking"
