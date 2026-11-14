"""Server-side checks: rule fixtures, and that the saved golden results still match the Python code.

If test_golden_is_current fails, run `python scripts/gen_golden.py` and re-run the engine tests
(cd packages/engine && npm test) so the phone and server stay in step.
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app import kb  # noqa: E402
from app.services import eligibility, jsonlogic, matcher  # noqa: E402

FIXTURES = [(r["id"], f) for r in kb.rules().values() for f in r.get("fixtures", [])]


@pytest.mark.parametrize("rule_id,fixture", FIXTURES, ids=[f"{rid}-{i}" for i, (rid, _) in enumerate(FIXTURES)])
def test_rule_fixture(rule_id, fixture):
    assert eligibility.check(rule_id, fixture["facts"])["status"] == fixture["expected"]


def test_unknown_only_when_it_matters():
    assert jsonlogic.apply({"and": [{"var": "x"}, False]}, {}) is False
    assert jsonlogic.apply({"or": [{"var": "x"}, True]}, {}) is True
    assert jsonlogic.apply({"and": [{"var": "x"}, True]}, {}) is jsonlogic.UNKNOWN


def test_every_scheme_has_a_rule():
    assert sorted(kb.schemes()) == sorted(kb.rules())


def test_golden_is_current():
    golden = json.loads((ROOT / "packages" / "engine" / "test" / "golden.json").read_text(encoding="utf-8"))
    for case in golden["recommend"]:
        assert matcher.recommend(case["persona"]) == case["result"]
    for case in golden["eligibility"]:
        assert eligibility.evaluate_all(case["facts"]) == case["result"]
    from app.services import tracing
    for case in golden["fold"]:
        assert tracing.fold_events(case["events"], case["opts"]) == case["result"], case["name"]
    from app.services import fitreach
    for case in golden["recommend_v2"]:
        assert fitreach.recommend_v2(case["persona"]) == case["result"]
