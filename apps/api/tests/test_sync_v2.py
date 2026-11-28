"""/v2/sync: idempotent upload, consent check, two devices, cursor paging."""
import pytest
from phones import PhoneClient
from fastapi.testclient import TestClient

B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
NOW = 1763000000000


def uid(n: int) -> str:
    """A valid 26-character ULID whose order follows n."""
    s = ""
    for _ in range(6):
        s = B32[n % 32] + s
        n //= 32
    return "01KA0000000000000000" + s


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app.main import app
    return PhoneClient(app, pg)


STUDENT = {"id": "st1", "name": "Meena", "class": 11, "gender": "female", "district": "Dharmapuri",
           "consent": {"id": "c1", "scopes": ["assess"], "method": "paper_form", "granted_at": NOW}}


def self_report(n, student="st1", device="phoneA"):
    return {"id": uid(n), "student_id": student, "device_id": device, "kind": "self_report",
            "skill_id": "sk_stitching", "payload": {"source": "voice"}, "created_at": NOW + n}


def test_same_batch_twice_is_harmless(client):
    body = {"device_id": "phoneA", "students": [STUDENT], "events": [self_report(1), self_report(2)]}
    r1 = client.post("/v2/sync", json=body).json()
    r2 = client.post("/v2/sync", json=body).json()
    assert r1["accepted"] == r2["accepted"] == [uid(1), uid(2)]
    assert r1["rejected"] == []
    from app import db, settings
    with db.connect() as con:
        assert con.execute("select count(*) as n from evidence_event").fetchone()["n"] == 2
        assert con.execute(
            "select pgp_sym_decrypt(name_enc, %s::text) as name from student_private",
            (settings.pii_key(),),
        ).fetchone()["name"] == "Meena"


def test_events_without_consent_are_rejected(client):
    no_consent = {**STUDENT, "id": "st2", "consent": None}
    r = client.post("/v2/sync", json={"device_id": "phoneA", "students": [no_consent],
                                      "events": [self_report(1, student="st2")]}).json()
    assert r["accepted"] == []
    assert r["rejected"][0]["errors"] == ["no consent to assess this student"]


def test_invalid_events_are_rejected_with_reasons(client):
    bad = {**self_report(1), "payload": {"source": "shout"}}
    r = client.post("/v2/sync", json={"device_id": "phoneA", "students": [STUDENT], "events": [bad]}).json()
    assert r["rejected"][0]["errors"] == ["payload.source must be voice, tap or text"]


def test_teacher_rating_reaches_the_student_phone(client):
    sample = {"id": uid(1), "student_id": "st1", "device_id": "phoneA", "kind": "work_sample", "skill_id": "sk_stitching",
              "payload": {"rubric_id": "rb_stitching", "scorer": "ai", "scores": {"seams": 2}}, "created_at": NOW}
    a = client.post("/v2/sync", json={"device_id": "phoneA", "students": [STUDENT], "events": [sample]}).json()
    assert a["events"] == []
    rating = {"id": uid(2), "student_id": "st1", "device_id": "phoneT", "kind": "rating", "rater_id": "t1",
              "refers_to": uid(1), "payload": {"scores": {"seams": 2}}, "created_at": NOW + 10}
    t = client.post("/v2/sync", json={"device_id": "phoneT", "raters": [{"id": "t1", "role": "teacher"}],
                                      "events": [rating], "student_ids": ["st1"], "cursor": 0}).json()
    assert t["accepted"] == [uid(2)]
    assert [e["id"] for e in t["events"]] == [uid(1)]  # the teacher phone gets the sample
    back = client.post("/v2/sync", json={"device_id": "phoneA", "student_ids": ["st1"], "cursor": a["cursor"]}).json()
    assert [e["id"] for e in back["events"]] == [uid(2)]
    assert back["events"][0]["created_at"] == NOW + 10
    # Still recent: sent again (the phone skips ids it has), in case an earlier number is still committing.
    again = client.post("/v2/sync", json={"device_id": "phoneA", "student_ids": ["st1"], "cursor": back["cursor"]}).json()
    assert [e["id"] for e in again["events"]] == [uid(2)]
    # Once settled, the cursor moves past it.
    from app import db
    with db.connect() as con:
        con.execute("update evidence_event set received_at = received_at - interval '2 minutes'")
    settled = client.post("/v2/sync", json={"device_id": "phoneA", "student_ids": ["st1"], "cursor": again["cursor"]}).json()
    assert [e["id"] for e in settled["events"]] == [uid(2)]
    done = client.post("/v2/sync", json={"device_id": "phoneA", "student_ids": ["st1"], "cursor": settled["cursor"]}).json()
    assert done["events"] == []


def test_late_commit_with_a_lower_number_still_reaches_the_phone(client):
    """Two teacher events: number 2 is visible first, number 1 commits later. The phone must get both."""
    from app import db
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [STUDENT]})
    client.post("/v2/sync", json={"device_id": "phoneT", "raters": [{"id": "t1", "role": "teacher"}]})
    with db.connect() as con:
        first = con.execute("select nextval(pg_get_serial_sequence('evidence_event', 'seq')) as s").fetchone()["s"]
    late = {"id": uid(1), "student_id": "st1", "device_id": "phoneT", "kind": "rating", "rater_id": "t1",
            "skill_id": "sk_stitching", "payload": {"endorse": True}, "created_at": NOW}
    early = {**late, "id": uid(2), "created_at": NOW + 1}
    client.post("/v2/sync", json={"device_id": "phoneT", "events": [early]})       # gets a higher number
    seen = client.post("/v2/sync", json={"device_id": "phoneA", "student_ids": ["st1"], "cursor": 0}).json()
    assert [e["id"] for e in seen["events"]] == [uid(2)]
    with db.connect() as con:                                                       # the slow one commits now
        con.execute("insert into evidence_event(id, seq, student_id, device_id, kind, skill_id, payload, rater_id, "
                    "created_at) values (%s, %s, 'st1', 'phoneT', 'rating', 'sk_stitching', '{\"endorse\": true}', 't1', "
                    "to_timestamp(%s / 1000.0))", (late["id"], first, NOW))
    nxt = client.post("/v2/sync", json={"device_id": "phoneA", "student_ids": ["st1"], "cursor": seen["cursor"]}).json()
    assert uid(1) in [e["id"] for e in nxt["events"]]


def test_rating_for_unknown_event_waits(client):
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [STUDENT]})
    rating = {"id": uid(5), "student_id": "st1", "device_id": "phoneT", "kind": "rating", "rater_id": "t1",
              "refers_to": uid(4), "payload": {"scores": {"seams": 1}}, "created_at": NOW}
    r = client.post("/v2/sync", json={"device_id": "phoneT", "raters": [{"id": "t1", "role": "teacher"}],
                                      "events": [rating]}).json()
    assert r["rejected"][0]["errors"] == ["refers_to an event the server does not have yet"]


def test_cursor_pages_through_1000_events(client):
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [STUDENT]})
    for start in range(0, 1000, 500):
        evs = [self_report(n) for n in range(start, start + 500)]
        r = client.post("/v2/sync", json={"device_id": "phoneA", "events": evs}).json()
        assert len(r["accepted"]) == 500
    seen, cursor, page_from = [], 0, None
    for _ in range(5):
        r = client.post("/v2/sync", json={"device_id": "phoneB", "student_ids": ["st1"], "cursor": cursor,
                                          "page_from": page_from}).json()
        seen += [e["id"] for e in r["events"]]
        cursor, page_from = r["cursor"], r["page_from"]
        if not r["more"]:
            break
    assert len(seen) == 1000 and len(set(seen)) == 1000
    assert cursor == 0  # all just arrived: the stored cursor waits until they settle


def test_sync_rebuilds_skill_levels_for_teachers(client):
    sample = {"id": uid(1), "student_id": "st1", "device_id": "phoneA", "kind": "work_sample", "skill_id": "sk_stitching",
              "payload": {"rubric_id": "rb_stitching", "scorer": "ai", "scores": {"seams": 2, "edges": 2}}, "created_at": NOW}
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [STUDENT], "events": [self_report(0), sample]})
    from app import db
    with db.connect() as con:
        rows = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id = 'st1'")}
    assert set(rows) >= {"ss_stitch_machine", "ss_stitch_fitting", "ss_stitch_measure", "ss_stitch_cutting"}
    assert rows["ss_stitch_machine"][2] + rows["ss_stitch_machine"][3] > 0.5  # likely level 3 or above
