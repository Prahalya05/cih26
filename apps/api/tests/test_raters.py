"""Rater reliability: a teacher who rates everyone level 4 ends up with much less weight."""
import random

from app.services import irt, raters
from scenarios import DAY, T0, ulid_at


def make_class(n_students=15, seed=3):
    rng = random.Random(seed)
    by_student = {}
    units = ["ss_stitch_machine", "ss_money_pricing", "ss_teach_explain"]
    bands = [(-2.5, -1.0), (-1.0, 0.3), (0.3, 1.5), (1.5, 2.5)]
    for s in range(n_students):
        events, k = [], 0

        def add(day, kind, **kw):
            nonlocal k
            t = T0 + int(day * DAY) + k
            events.append({"id": ulid_at(t, k), "student_id": f"s{s}", "device_id": "d", "kind": kind,
                           "payload": kw.pop("payload", {}), "created_at": t, **kw})
            k += 1
        for u in units:
            level = rng.choice([1, 2, 3])
            theta = rng.uniform(*bands[level - 1])
            for i in range(8):  # a test the raters don't control
                b = -2 + 0.6 * i
                add(1, "item_response", subskill_id=u, item_id=f"{u}_{i}",
                    payload={"correct": rng.random() < irt.p_correct(theta, 1.3, b), "ms": 5000, "b": b, "a": 1.3})
            add(2, "rating", subskill_id=u, rater_id="fair_teacher", payload={"level": level})
            add(2, "rating", subskill_id=u, rater_id="lenient_teacher", payload={"level": 4})
        by_student[f"s{s}"] = events
    return by_student


def test_lenient_rater_gets_less_weight():
    stats = raters.compute(make_class(), T0 + 10 * DAY)
    fair, lenient = stats["fair_teacher"], stats["lenient_teacher"]
    assert fair["agreement"] > 0.5, fair
    assert lenient["leniency"] > 1, lenient
    assert lenient["agreement"] < 0.5 * fair["agreement"], (fair, lenient)


def test_kappa_basics():
    assert raters.weighted_kappa([1, 2, 3, 4], [1, 2, 3, 4]) == 1.0
    assert raters.weighted_kappa([4, 4, 4, 4], [1, 2, 3, 4]) <= 0.0
