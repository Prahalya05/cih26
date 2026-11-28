"""Device tokens and school scoping: phones only see and change their own school's students."""
import psycopg
import pytest
from fastapi.testclient import TestClient
from phones import PhoneClient

import add_join_code

NOW = 1763000000000
CONSENT = {"id": "c_a1", "scopes": ["assess", "photos"], "method": "paper_form", "granted_at": NOW}


def uid(n: int) -> str:
    return f"01KA00000000000000000000{n:02d}"


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app.main import app
    # phoneA and phoneT are in school sch_test; phoneB and phoneU (teacher) in sch_other.
    return PhoneClient(app, pg, teachers=("phoneT", "phoneU"), schools={"phoneB": "sch_other", "phoneU": "sch_other"})


@pytest.fixture()
def school_a(client):
    """Student a1 of sch_test with one order, synced from phoneA."""
    out = client.post("/v2/sync", json={"device_id": "phoneA", "students": [{"id": "a1", "name": "Meena", "consent": CONSENT}],
                                         "events": [{"id": uid(1), "student_id": "a1", "device_id": "phoneA", "kind": "order",
                                                     "skill_id": "sk_stitching", "payload": {"amount_inr": 100, "what": "Blouse"},
                                                     "created_at": NOW}]}).json()
    assert out["accepted"] == [uid(1)]
    return "a1"


def school_of(url: str, student_id: str):
    with psycopg.connect(url) as con:
        row = con.execute("select school_id from student where id = %s", (student_id,)).fetchone()
    return row[0] if row else None


def test_no_token_no_student_data(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app.main import app
    anon = TestClient(app)
    assert anon.post("/v2/sync", json={"device_id": "x"}).status_code == 401
    assert anon.request("DELETE", "/v2/student/a1", json={"confirmed_by": "guardian"}).status_code == 401
    assert anon.post(f"/v2/orders/{uid(1)}/link").status_code == 401
    assert anon.post("/v2/work-sample/score", data={"student_id": "a1", "rubric_id": "rb_stitching"},
                     files={"image": ("w.jpg", b"x", "image/jpeg")}).status_code == 401
    assert anon.post("/v1/profile/extract", data={"question": "q", "text": "I stitch"}).status_code == 401
    assert anon.post("/v1/sync", json={}).status_code == 401
    assert anon.get("/v1/facilitator/PSG01/cohort").status_code == 401
    assert anon.post("/v2/sync", json={"device_id": "x"}, headers={"Authorization": "Bearer made-up"}).status_code == 401
    # Open endpoints stay open.
    assert anon.get("/health").status_code == 200
    assert anon.get("/v1/kb").status_code == 200


def test_register_with_codes(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app.main import app
    anon = TestClient(app)
    with psycopg.connect(pg) as con:
        add_join_code.add_school(con, "sch_psg", "PSG School", "Coimbatore")
        add_join_code.add_school(con, "sch_kvr", "KVR School", "Madurai")
        teacher_code = add_join_code.add_class(con, "sch_psg", "psg01")
        add_join_code.add_class(con, "sch_kvr", "KVR01")
    assert anon.post("/v2/devices", json={"device_id": "phone1", "code": "NOPE"}).status_code == 404
    st = anon.post("/v2/devices", json={"device_id": "phone1", "code": " psg01 "}).json()
    assert st["role"] == "student" and st["school_id"] == "sch_psg" and st["class_code"] == "PSG01"
    t = anon.post("/v2/devices", json={"device_id": "phone2", "code": teacher_code.lower()}).json()
    assert t["role"] == "teacher" and t["class_code"] == "PSG01"
    # The token works, and a teacher's phone cannot be taken over with the class code.
    ok = anon.post("/v2/sync", json={"device_id": "phone2"}, headers={"Authorization": f"Bearer {t['token']}"})
    assert ok.status_code == 200
    assert anon.post("/v2/devices", json={"device_id": "phone2", "code": "PSG01"}).status_code == 409
    # A phone stays with its school.
    assert anon.post("/v2/devices", json={"device_id": "phone1", "code": "KVR01"}).status_code == 409
    # Registering again replaces the old token.
    again = anon.post("/v2/devices", json={"device_id": "phone1", "code": "PSG01"}).json()
    assert anon.post("/v2/sync", json={"device_id": "phone1"},
                     headers={"Authorization": f"Bearer {st['token']}"}).status_code == 401
    assert anon.post("/v2/sync", json={"device_id": "phone1"},
                     headers={"Authorization": f"Bearer {again['token']}"}).status_code == 200
    # A switched-off phone and a revoked code stop working.
    with psycopg.connect(pg) as con:
        con.execute("update device set revoked_at = now() where id = 'phone1'")
        con.execute("update join_code set revoked_at = now() where code = 'KVR01'")
    assert anon.post("/v2/sync", json={"device_id": "phone1"},
                     headers={"Authorization": f"Bearer {again['token']}"}).status_code == 401
    assert anon.post("/v2/devices", json={"device_id": "phone1", "code": "PSG01"}).status_code == 403
    assert anon.post("/v2/devices", json={"device_id": "phone9", "code": "KVR01"}).status_code == 404


def test_device_id_must_match_token(client):
    r = client.post("/v2/sync", json={"device_id": "phoneB"}, headers=client.as_phone("phoneA"))
    assert r.status_code == 403


def test_other_school_cannot_read_or_change_a_student(client, school_a, pg):
    # Reading: asking for a1's events from another school returns nothing.
    out = client.post("/v2/sync", json={"device_id": "phoneB", "student_ids": ["a1"], "cursor": 0}).json()
    assert out["events"] == []
    # Writing: events for a1 are refused, and a student record with a1's id does not move her.
    ev = {"id": uid(2), "student_id": "a1", "device_id": "phoneB", "kind": "self_report", "skill_id": "sk_stitching",
          "payload": {"confidence": 0.9, "source": "voice"}, "created_at": NOW}
    out = client.post("/v2/sync", json={"device_id": "phoneB", "events": [ev],
                                         "students": [{"id": "a1", "name": "Someone else", "school_id": "sch_other",
                                                       "consent": {**CONSENT, "revoked_at": NOW}}]}).json()
    assert out["rejected"] == [{"id": uid(2), "errors": ["student belongs to another school"]}]
    assert school_of(pg, "a1") == "sch_test"
    from app import settings
    with psycopg.connect(pg) as con:
        assert con.execute(
            "select pgp_sym_decrypt(name_enc, %s::text) from student_private where student_id = 'a1'",
            (settings.pii_key(),),
        ).fetchone()[0] == "Meena"
        assert con.execute("select revoked_at from consent where student_id = 'a1'").fetchone()[0] is None
    # Buyer link, photo scoring and deletion are refused too.
    phone_b = client.as_phone("phoneB")
    assert client.post(f"/v2/orders/{uid(1)}/link", headers=phone_b).status_code == 404
    assert client.post("/v2/work-sample/score", data={"student_id": "a1", "rubric_id": "rb_stitching"},
                       files={"image": ("w.jpg", b"x", "image/jpeg")}, headers=phone_b).status_code == 403
    assert client.request("DELETE", "/v2/student/a1", json={"confirmed_by": "guardian"}, headers=phone_b).status_code == 403
    assert school_of(pg, "a1") == "sch_test"
    # The student's own school still can.
    assert client.post(f"/v2/orders/{uid(1)}/link").status_code == 200
    assert client.request("DELETE", "/v2/student/a1", json={"confirmed_by": "guardian"}).json() == {"deleted": True}


def test_the_school_comes_from_the_token(client, pg):
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [{"id": "a2", "school_id": "sch_other", "consent": CONSENT}]})
    assert school_of(pg, "a2") == "sch_test"


def test_only_a_teacher_phone_rates(client, school_a):
    rating = {"id": uid(3), "student_id": "a1", "device_id": "phoneA", "kind": "rating", "rater_id": "r_fake",
              "refers_to": uid(1), "payload": {"on_time": True, "quality": True, "rehire": True}, "created_at": NOW + 1}
    out = client.post("/v2/sync", json={"device_id": "phoneA", "raters": [{"id": "r_fake", "role": "teacher"}],
                                         "events": [rating]}).json()
    assert out["rejected"] == [{"id": uid(3), "errors": ["only a teacher's phone can rate"]}]
    # A teacher's phone can, but cannot invent buyers.
    t_rating = {**rating, "id": uid(4), "device_id": "phoneT", "rater_id": "t1"}
    buyer = {**rating, "id": uid(5), "device_id": "phoneT", "rater_id": "fake_buyer"}
    out = client.post("/v2/sync", json={"device_id": "phoneT", "events": [t_rating, buyer],
                                         "raters": [{"id": "t1", "role": "teacher"}, {"id": "fake_buyer", "role": "buyer"}]}).json()
    assert out["accepted"] == [uid(4)]
    assert out["rejected"] == [{"id": uid(5), "errors": ["unknown rater"]}]


def test_teacher_of_another_school_cannot_rate_or_use_its_raters(client, school_a):
    client.post("/v2/sync", json={"device_id": "phoneT", "raters": [{"id": "t1", "role": "teacher"}]})
    rating = {"id": uid(6), "student_id": "a1", "device_id": "phoneU", "kind": "rating", "rater_id": "t1",
              "skill_id": "sk_stitching", "payload": {"endorse": True}, "created_at": NOW + 1}
    out = client.post("/v2/sync", json={"device_id": "phoneU", "events": [rating]}).json()
    assert out["rejected"][0]["errors"] == ["student belongs to another school"]
    # Even for its own student, school B's teacher cannot use school A's rater.
    client.post("/v2/sync", json={"device_id": "phoneB", "students": [{"id": "b1", "consent": {**CONSENT, "id": "c_b1"}}]})
    out = client.post("/v2/sync", json={"device_id": "phoneU", "events": [{**rating, "student_id": "b1"}]}).json()
    assert out["rejected"][0]["errors"] == ["unknown rater"]


def test_students_from_before_tokens_join_the_first_school_that_syncs_them(client, pg):
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("insert into student(id) values ('old1')")
    client.post("/v2/sync", json={"device_id": "phoneB", "student_ids": ["old1"]})
    assert school_of(pg, "old1") == "sch_other"
    client.post("/v2/sync", json={"device_id": "phoneA", "student_ids": ["old1"]})
    assert school_of(pg, "old1") == "sch_other"


def test_legacy_cohort_is_limited_to_the_school(client):
    doc = {"id": "s1", "name": "Meena", "facilitator_code": "PSG01", "updated_at": 2}
    client.post("/v1/sync", json={"students": [doc]}, headers=client.as_phone("phoneA"))
    # Another school's phone cannot overwrite the document or see it in its cohort.
    out = client.post("/v1/sync", json={"students": [{**doc, "name": "X", "updated_at": 3}]},
                      headers=client.as_phone("phoneB")).json()
    assert out["stored_students"] == 0
    assert client.get("/v1/facilitator/PSG01/cohort", headers=client.as_phone("phoneU")).json()["students"] == []
    mine = client.get("/v1/facilitator/PSG01/cohort", headers=client.as_phone("phoneT")).json()["students"]
    assert [s["name"] for s in mine] == ["Meena"]
