"""Failure tests (Step 13.3).

1. Gemini failure: with a key set but Gemini unreachable, photo scoring answers "unavailable" (the phone keeps
   the sample for a teacher), voice/text extraction falls back to keywords, and nothing else breaks.
2. Network flapping: a phone syncs while requests and responses are randomly lost. No event is lost or
   duplicated on the server, and every event from another device reaches the phone exactly once.
   The phone side is a model of apps/web/src/lib/sync.ts (mark sent events only when the answer arrives;
   keep the cursor only when the answer arrives; skip events it already has).
"""
from __future__ import annotations

import random

import httpx
import pytest
from fastapi.testclient import TestClient

from scenarios import ulid_at

NOW = 1763000000000
CONSENT = {"scopes": ["assess", "photos"], "method": "paper_form", "granted_at": NOW}


@pytest.fixture()
def client(pg, monkeypatch):
    from app.main import app
    return TestClient(app)


# ---------- Gemini down ----------

def test_gemini_down_nothing_breaks(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")

    def down(*a, **k):
        raise httpx.ConnectError("network unreachable")

    monkeypatch.setattr(httpx, "post", down)
    student = {"id": "st1", "consent": {"id": "c1", **CONSENT}}
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [student]})

    # Photo scoring: "unavailable", so the phone keeps the sample for the teacher.
    r = client.post("/v2/work-sample/score", data={"student_id": "st1", "rubric_id": "rb_stitching"},
                    files={"image": ("w.jpg", b"\xff\xd8\xff", "image/jpeg")})
    assert r.status_code == 503

    # Speech/text extraction falls back to keywords.
    out = client.post("/v1/profile/extract", data={"question": "What do you do?", "text": "I stitch blouses"}).json()
    assert out["source"] == "keywords" and any(s["id"] == "sk_stitching" for s in out["skills"])

    # The pending sample syncs, a teacher on another phone scores it, and the level updates.
    pending = {"id": ulid_at(NOW, 1), "student_id": "st1", "device_id": "phoneA", "kind": "work_sample",
               "skill_id": "sk_stitching", "payload": {"rubric_id": "rb_stitching", "scorer": "pending", "media_ref": "m1"},
               "created_at": NOW}
    assert client.post("/v2/sync", json={"device_id": "phoneA", "events": [pending]}).json()["accepted"] == [pending["id"]]
    t = client.post("/v2/sync", json={"device_id": "phoneT", "student_ids": ["st1"], "cursor": 0,
                                      "raters": [{"id": "teacher1", "role": "teacher"}],
                                      "events": [{"id": ulid_at(NOW + 5, 2), "student_id": "st1", "device_id": "phoneT",
                                                  "kind": "rating", "rater_id": "teacher1", "refers_to": pending["id"],
                                                  "payload": {"scores": {"seams": 2, "even": 2, "edges": 1, "fit": 2, "shape": 2}},
                                                  "created_at": NOW + 5}]}).json()
    assert len(t["accepted"]) == 1 and [e["id"] for e in t["events"]] == [pending["id"]]
    from app import db
    with db.connect() as con:
        p = con.execute("select p_level from skill_state where student_id='st1' and subskill_id='ss_stitch_machine'").fetchone()
    assert p["p_level"][2] + p["p_level"][3] > 0.5
    assert client.get("/health").json()["ok"] is True


# ---------- network flapping ----------

class Phone:
    """What sync.ts does, reduced to the parts that matter for losing or duplicating events."""

    def __init__(self, device: str, student: str):
        self.device, self.student = device, student
        self.events: dict[str, dict] = {}   # id -> event (with "synced")
        self.cursor = 0
        self.received: list[str] = []      # ids of events from other devices, in arrival order

    def record(self, e: dict) -> None:
        self.events[e["id"]] = {**e, "synced": 0}

    def sync(self, client: TestClient, rng: random.Random, p_drop_request: float, p_drop_response: float) -> bool:
        pending = sorted((e for e in self.events.values() if e["synced"] == 0), key=lambda e: e["id"])
        batch = pending[: rng.randint(1, 15)] if pending else []
        if rng.random() < p_drop_request:
            return False                                    # never reached the server
        out = client.post("/v2/sync", json={
            "device_id": self.device, "cursor": self.cursor, "student_ids": [self.student],
            "students": [{"id": self.student, "consent": {"id": f"c_{self.student}", **CONSENT}}],
            "raters": [{"id": "teacher1", "role": "teacher"}],
            "events": [{k: v for k, v in e.items() if k != "synced"} for e in batch]}).json()
        if rng.random() < p_drop_response:
            return False                                    # server saved it, phone never heard back
        for i in out["accepted"]:
            self.events[i]["synced"] = 1
        for e in out["events"]:
            if e["id"] not in self.events:
                self.events[e["id"]] = {**e, "synced": 1}
                self.received.append(e["id"])
        self.cursor = out["cursor"]
        return True


def test_flapping_network_loses_and_duplicates_nothing(client):
    rng = random.Random(13)
    student = Phone("phoneA", "st1")
    teacher = Phone("phoneT", "st1")
    n = 0

    def new_event(phone: Phone, kind: str, **kw) -> dict:
        nonlocal n
        n += 1
        e = {"id": ulid_at(NOW + n * 1000, n), "student_id": "st1", "device_id": phone.device, "kind": kind,
             "created_at": NOW + n * 1000, **kw}
        phone.record(e)
        return e

    teacher_ids = []
    for step in range(120):
        # The student keeps answering questions offline; now and then the teacher endorses on another phone.
        new_event(student, "item_response", subskill_id="ss_stitch_machine", item_id=f"it_sth_0{1 + step % 6}",
                  payload={"correct": step % 3 != 0, "ms": 8000})
        if step % 10 == 0:
            teacher_ids.append(new_event(teacher, "rating", rater_id="teacher1", skill_id="sk_stitching",
                                         payload={"endorse": True})["id"])
        # Airplane mode on and off: about half of all requests or answers are lost.
        student.sync(client, rng, p_drop_request=0.3, p_drop_response=0.3)
        teacher.sync(client, rng, p_drop_request=0.3, p_drop_response=0.3)

    # Back online for good: keep syncing until nothing is waiting.
    for _ in range(100):
        student.sync(client, rng, 0, 0)
        teacher.sync(client, rng, 0, 0)
        if all(e["synced"] for p in (student, teacher) for e in p.events.values()):
            break
    student.sync(client, rng, 0, 0)

    from app import db
    with db.connect() as con:
        rows = con.execute("select id from evidence_event where student_id = 'st1'").fetchall()
    server_ids = [r["id"] for r in rows]
    made = {i for p in (student, teacher) for i, e in p.events.items() if e["device_id"] == p.device}
    assert len(server_ids) == len(set(server_ids)) == len(made) == 120 + 12   # nothing lost, nothing twice
    assert set(server_ids) == made
    assert sorted(student.received) == sorted(teacher_ids)                      # every endorsement arrived
    assert len(student.received) == len(set(student.received))                  # and only once
