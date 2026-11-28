"""Mathematical invariant (property) tests for Python scoring services."""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import kb  # noqa: E402
from app.services import fitreach, irt, matcher, tracing  # noqa: E402

NOW = 1_770_000_000_000


def test_weights_and_priors_sum_to_one():
    assert math.isclose(sum(tracing.PRIOR), 1.0, abs_tol=1e-9)
    assert math.isclose(sum(fitreach.UNKNOWN_LEVELS), 1.0, abs_tol=1e-9)
    assert math.isclose(sum(fitreach.FRW_WEIGHTS.values()), 1.0, abs_tol=1e-9)
    assert math.isclose(sum(fitreach.REACH_PARTS.values()), 1.0, abs_tol=1e-9)
    assert math.isclose(sum(fitreach.WORTH_PARTS.values()), 1.0, abs_tol=1e-9)
    assert math.isclose(sum(matcher.WEIGHTS.values()), 1.0, abs_tol=1e-9)
    assert all(0.0 <= d <= 1.0 for d in fitreach.DEMAND.values())


def test_probabilities_sum_to_one_and_never_nan():
    post = irt.prior()
    assert math.isclose(sum(post), 1.0, abs_tol=1e-9)
    assert all(math.isfinite(x) and x >= 0 for x in post)

    items = [{"id": "i1", "a": 1.5, "b": -2.0}, {"id": "i2", "a": 2.0, "b": 0.0}, {"id": "i3", "a": 2.5, "b": 2.0}]
    for correct in (True, False, True, True, False):
        for it in items:
            post = irt.update(post, it, correct)
            assert math.isclose(sum(post), 1.0, abs_tol=1e-9)
            assert all(math.isfinite(x) and x >= 0 for x in post)

    events = [
        {"id": "e1", "student_id": "s1", "device_id": "d1", "kind": "self_report", "skill_id": "sk_stitch", "payload": {"source": "tap"}, "created_at": NOW - 30 * 86_400_000},
        {"id": "e2", "student_id": "s1", "device_id": "d1", "kind": "task", "subskill_id": "ss_stitch_machine", "payload": {"score": 0.9}, "created_at": NOW - 20 * 86_400_000},
        {"id": "e3", "student_id": "s1", "device_id": "d1", "kind": "order", "skill_id": "sk_stitch", "subskill_id": "ss_stitch_machine", "payload": {"amount_inr": 300}, "created_at": NOW - 5 * 86_400_000},
        {"id": "e4", "student_id": "s1", "device_id": "d1", "kind": "rating", "skill_id": "sk_stitch", "refers_to": "e3", "rater_id": "b1", "payload": {"quality": True, "rehire": True}, "created_at": NOW - 2 * 86_400_000},
    ]
    prof = tracing.fold_events(events, {"now": NOW})
    for u in prof["units"].values():
        assert len(u["p"]) == 4
        assert all(math.isfinite(x) and 0 <= x <= 1 for x in u["p"])
        assert math.isclose(sum(u["p"]), 1.0, abs_tol=1e-9)
        assert math.isfinite(u["confidence"]) and 0.5 <= u["confidence"] <= 1.0


def test_more_correct_answers_never_lower_level():
    item = {"id": "q1", "a": 1.4, "b": 0.2}
    p0 = irt.prior()
    assert irt.eap(irt.update(p0, item, True)) >= irt.eap(p0)
    assert irt.eap(irt.update(p0, item, True)) >= irt.eap(irt.update(p0, item, False))

    prev_level = 1
    for n_correct in range(7):
        events = [
            {
                "id": f"q_{i}", "student_id": "s1", "device_id": "d1", "kind": "item_response",
                "subskill_id": "ss_stitch_machine", "item_id": f"it_{i}",
                "payload": {"correct": i < n_correct, "a": 1.2, "b": -0.5 + i * 0.4},
                "created_at": NOW + i * 1000,
            }
            for i in range(6)
        ]
        lvl = tracing.fold_events(events, {"now": NOW + 10_000})["units"]["ss_stitch_machine"]["level"]
        assert lvl >= prev_level
        prev_level = lvl


def test_good_confirmed_order_never_lowers_level():
    bases = [
        [],
        [{"id": "b1", "student_id": "s1", "device_id": "d1", "kind": "self_report", "subskill_id": "ss_stitch_machine", "payload": {"source": "tap"}, "created_at": NOW - 10_000}],
        [{"id": "b2", "student_id": "s1", "device_id": "d1", "kind": "task", "subskill_id": "ss_stitch_machine", "payload": {"score": 0.9}, "created_at": NOW - 10_000}],
        [{"id": "b3", "student_id": "s1", "device_id": "d1", "kind": "rating", "subskill_id": "ss_stitch_machine", "rater_id": "t1", "payload": {"level": 3}, "created_at": NOW - 10_000}],
    ]
    for base in bases:
        before = tracing.fold_events(base, {"now": NOW})["units"].get("ss_stitch_machine", {}).get("level", 1)
        with_order = [
            *base,
            {"id": "o1", "student_id": "s1", "device_id": "d1", "kind": "order", "skill_id": "sk_stitch", "subskill_id": "ss_stitch_machine", "payload": {"amount_inr": 250}, "created_at": NOW - 2000},
            {"id": "r1", "student_id": "s1", "device_id": "d1", "kind": "rating", "skill_id": "sk_stitch", "refers_to": "o1", "rater_id": "buyer1", "payload": {"quality": True, "rehire": True}, "created_at": NOW - 1000},
        ]
        after = tracing.fold_events(with_order, {"now": NOW})["units"]["ss_stitch_machine"]["level"]
        assert after >= before


def test_fitreach_parts_stay_in_unit_interval():
    personas = [
        {"levels": {}},
        {"education": "class8", "riasec": {}, "levels": {"ss_stitch_machine": [1, 0, 0, 0]}, "aptitude": {"apt_spatial": {"theta": -4}}},
        {"education": "ug", "riasec": {k: 1 for k in "RIASEC"}, "levels": {"ss_stitch_machine": [0, 0, 0, 1]}, "aptitude": {"apt_spatial": {"theta": 4}}},
    ]
    for p in personas:
        for c in fitreach.score_all_v2(p):
            assert 0.0 <= c["score"] <= 1.0 and math.isfinite(c["score"])
            for k in ("fit", "reach", "worth", "aptitude"):
                assert 0.0 <= c["parts"][k] <= 1.0


def test_level_4_cap_for_unpaid_evidence_holds():
    unpaid = []
    for i in range(15):
        unpaid.append({"id": f"t_{i}", "student_id": "s1", "device_id": "d1", "kind": "task", "subskill_id": "ss_stitch_machine", "payload": {"score": 1.0}, "created_at": NOW - (20 - i) * 1000})
        unpaid.append({"id": f"r_{i}", "student_id": "s1", "device_id": "d1", "kind": "rating", "subskill_id": "ss_stitch_machine", "rater_id": f"t_{i}", "payload": {"level": 4}, "created_at": NOW - (20 - i) * 1000 + 100})
    u = tracing.fold_events(unpaid, {"now": NOW})["units"]["ss_stitch_machine"]
    assert u["paid"] is False
    assert u["p"][3] <= 0.4 + 1e-9
    assert u["level"] <= 3


def test_rater_leniency_flag_off_by_default():
    ev = [{"id": "r1", "student_id": "s1", "device_id": "d1", "kind": "rating", "subskill_id": "ss_stitch_machine",
           "rater_id": "t_len", "payload": {"level": 3}, "created_at": NOW - 1000}]
    off_default = tracing.fold_events(ev, {"now": NOW, "raterLeniency": {"t_len": 1.2}})["units"]["ss_stitch_machine"]
    off_explicit = tracing.fold_events(ev, {"now": NOW, "raterLeniency": {"t_len": 1.2}, "applyLeniency": False})["units"]["ss_stitch_machine"]
    assert off_default["p"] == off_explicit["p"]

    on = tracing.fold_events(ev, {"now": NOW, "raterLeniency": {"t_len": 1.2}, "applyLeniency": True})["units"]["ss_stitch_machine"]
    assert on["p"][2] < off_default["p"][2]
    assert on["level"] <= off_default["level"]
