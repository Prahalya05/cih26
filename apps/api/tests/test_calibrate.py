"""Step 12.4: the recalibration script recovers difficulties and catches unfair or misbehaving questions."""
import json
import math
import random
import shutil

import calibrate

TRUE_B = [-2.0, -1.5, -1.0, -0.6, -0.3, 0.0, 0.3, 0.6, 1.0, 1.5, 2.0]


def pilot(n=400, seed=1):
    """Synthetic answers. q_unfair is 1.5 logits harder for girls; q_noise is a coin flip for everyone."""
    rng = random.Random(seed)
    bank = {f"q{k}": {"id": f"q{k}", "subskill": "ss_x", "b": round(b + rng.uniform(-0.5, 0.5), 2)}
            for k, b in enumerate(TRUE_B)}
    bank["q_unfair"] = {"id": "q_unfair", "subskill": "ss_x", "b": 0.0}
    bank["q_noise"] = {"id": "q_noise", "subskill": "ss_x", "b": 0.0}
    students, events = [], []
    t = 1763000000000
    for s in range(n):
        sid = f"s{s}"
        g = "female" if s % 2 else "male"
        students.append({"id": sid, "gender": g, "medium": "tamil" if s % 3 else "english"})
        theta = rng.gauss(0, 1.2)
        for k, b in enumerate(TRUE_B + [0.0, None]):
            item = f"q{k}" if k < len(TRUE_B) else ("q_unfair" if b is not None else "q_noise")
            if item == "q_noise":
                p = 0.5
            else:
                p = 1 / (1 + math.exp((b + (1.5 if item == "q_unfair" and g == "female" else 0)) - theta))
            t += 1
            events.append({"id": f"e{t}", "student_id": sid, "kind": "item_response", "item_id": item,
                           "payload": {"correct": rng.random() < p}, "created_at": t})
    return events, students, bank


def corr(xs, ys):
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return sxy / math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))


def test_recovers_difficulties():
    events, students, bank = pilot()
    r = calibrate.calibrate(events, students, bank)["items"]
    got = [r[f"q{k}"]["b_pilot"] for k in range(len(TRUE_B))]
    assert corr(got, TRUE_B) > 0.97
    # New values are a 50:50 blend of the old value and the pilot estimate.
    q = r["q3"]
    assert q["b_new"] == round(0.5 * q["b_old"] + 0.5 * q["b_pilot"], 2)


def test_flags_unfair_and_misfitting_questions():
    events, students, bank = pilot()
    r = calibrate.calibrate(events, students, bank)["items"]
    assert r["q_unfair"]["rewrite"] == ["gender"] and r["q_unfair"]["dif_gender"]["delta"] < 0
    assert r["q_noise"]["retire"]
    clean = [f"q{k}" for k in range(len(TRUE_B))]
    assert sum(bool(r[i]["rewrite"]) for i in clean) <= 1
    assert sum(r[i]["retire"] for i in clean) <= 1


def test_first_answer_only_and_too_few_answers_change_nothing():
    events, students, bank = pilot(n=12)
    events.append({**events[0], "id": "dup", "created_at": events[0]["created_at"] + 10**9,
                   "payload": {"correct": not events[0]["payload"]["correct"]}})
    assert len(calibrate.first_answers(events)) == 12 * 13
    r = calibrate.calibrate(events, students, bank)["items"]
    assert all(not x["changed"] and x["b_new"] == x["b_old"] for x in r.values())


def test_write_keeps_one_question_per_line(tmp_path, monkeypatch):
    shutil.copytree(calibrate.ITEMS_DIR, tmp_path / "items")
    monkeypatch.setattr(calibrate, "ITEMS_DIR", tmp_path / "items")
    path = tmp_path / "items" / "stitching.json"
    before = path.read_text(encoding="utf-8").split("\n")
    first = json.loads(path.read_text(encoding="utf-8"))[0]["id"]
    report = {"items": {first: {"changed": True, "b_new": 0.42, "retire": True}}}
    assert calibrate.write_bank(report) == 1
    after = path.read_text(encoding="utf-8").split("\n")
    assert len(after) == len(before)
    item = json.loads(path.read_text(encoding="utf-8"))[0]
    assert item["b"] == 0.42 and item["b_source"] == "pilot_rasch" and item["retired"] is True
