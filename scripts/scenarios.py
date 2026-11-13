"""Named evidence stories used by golden tests, the demo and the docs (the Meena worked example).

Each scenario is a list of events plus the item and rubric data they need. Times are fixed so results repeat.
"""
from __future__ import annotations

DAY = 86_400_000
T0 = 1_762_000_000_000  # a fixed start date (early Nov 2025)
B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def ulid_at(t: int, n: int) -> str:
    """Deterministic ULID: time part from t, a counter in the random part."""
    time = ""
    x = t
    for _ in range(10):
        time = B32[x % 32] + time
        x //= 32
    rnd = ""
    for _ in range(16):
        rnd = B32[n % 32] + rnd
        n //= 32
    return time + rnd


class Story:
    def __init__(self, student: str = "meena"):
        self.student = student
        self.events: list[dict] = []
        self.n = 0

    def add(self, day: float, kind: str, **kw) -> str:
        t = T0 + int(day * DAY) + self.n
        e = {"id": ulid_at(t, self.n), "student_id": self.student, "device_id": kw.pop("device", "phone_meena"),
             "kind": kind, "payload": kw.pop("payload", {}), "created_at": t, **kw}
        self.n += 1
        self.events.append(e)
        return e["id"]


ITEMS = {f"it_fit_{i}": {"id": f"it_fit_{i}", "a": 1.2, "b": b, "format": "picture_choice"}
         for i, b in enumerate([-1.2, -0.6, 0.0, 0.4, 0.8, 1.2, 1.6, 2.0])}
RUBRICS = {"rb_stitching": {"id": "rb_stitching", "skill": "sk_stitching", "criteria": [
    {"id": "seams", "subskill": "ss_stitch_machine"},
    {"id": "edges", "subskill": "ss_stitch_machine"},
    {"id": "fit", "subskill": "ss_stitch_fitting"},
]}}


def meena() -> tuple[list[dict], dict, list[tuple[str, int]]]:
    """The worked example. Returns events, options, and checkpoints (label, number of events so far)."""
    s = Story()
    checkpoints = []
    s.add(0, "self_report", skill_id="sk_stitching", payload={"source": "voice", "qid": "home", "evidence": "I stitch blouses for my aunt"})
    checkpoints.append(("said", len(s.events)))
    for i, correct in [(2, True), (3, True), (4, True), (5, False), (1, True), (6, False)]:
        s.add(1, "item_response", subskill_id="ss_stitch_fitting", item_id=f"it_fit_{i}", payload={"correct": correct, "ms": 6000})
    checkpoints.append(("test", len(s.events)))
    sample = s.add(8, "work_sample", skill_id="sk_stitching",
                   payload={"rubric_id": "rb_stitching", "scorer": "ai", "scores": {"seams": 2, "edges": 1, "fit": 2}})
    checkpoints.append(("photo", len(s.events)))
    s.add(15, "rating", rater_id="teacher_1", refers_to=sample, device="phone_teacher",
          payload={"scores": {"seams": 2, "edges": 2, "fit": 2}})
    checkpoints.append(("teacher", len(s.events)))
    for k in range(5):
        order = s.add(20 + k * 4, "order", skill_id="sk_stitching", payload={"amount_inr": 350})
        s.add(21 + k * 4, "rating", rater_id=f"buyer_{k}", refers_to=order, device="buyer_link",
              payload={"on_time": True, "quality": True, "rehire": True})
    checkpoints.append(("orders", len(s.events)))
    opts = {"now": T0 + 42 * DAY, "items": ITEMS, "rubrics": RUBRICS}
    return s.events, opts, checkpoints


def aptitude_story() -> tuple[list[dict], dict]:
    s = Story()
    for i, (b, ok) in enumerate([(-1, True), (0, True), (0.5, True), (1, True), (1.5, False), (1.2, True)]):
        s.add(9, "aptitude_response", item_id=f"apt_sp_{i}", payload={"domain": "apt_spatial", "correct": ok, "ms": 4000, "b": b, "a": 1.3})
    for i, (b, ok) in enumerate([(-1, True), (0, False), (-0.5, True), (0.5, False)]):
        s.add(9, "aptitude_response", item_id=f"apt_nu_{i}", payload={"domain": "apt_numeric", "correct": ok, "ms": 4000, "b": b})
    return s.events, {"now": T0 + 10 * DAY}


def retraction_story() -> tuple[list[dict], dict]:
    s = Story("kavya")
    s.add(0, "self_report", skill_id="sk_cooking", payload={"source": "tap", "qid": "home"})
    s.add(0, "self_report", skill_id="sk_cooking", payload={"source": "tap", "qid": "home", "retracted": True})
    s.add(0, "self_report", skill_id="sk_drawing", payload={"source": "tap", "qid": "free_time"})
    s.add(1, "family_report", subskill_id="ss_draw_colour", payload={"source": "voice"})
    s.add(3, "task", subskill_id="ss_money_pricing", payload={"score": 0.8})
    s.add(4, "taster", rater_id="mentor_1", payload={"levels": {"ss_care_firstaid": 3, "ss_care_listening": 2}})
    s.add(5, "rating", rater_id="teacher_1", subskill_id="ss_teach_explain", payload={"level": 4})
    s.add(5, "rating", rater_id="teacher_lenient", skill_id="sk_driving", payload={"endorse": True})
    return s.events, {"now": T0 + 400 * DAY, "raterWeights": {"teacher_lenient": 0.1}}
