"""The online way into a class: teachers make classrooms, students ask to join, the teacher decides."""
import psycopg
import pytest
from fastapi.testclient import TestClient

import add_join_code  # noqa: F401  (conftest puts scripts/ on the path)


ADMIN = {"X-Admin-Token": "review-secret"}
PHOTO = bytes([0xFF, 0xD8, 0xFF]) + b"0" * 4000  # stands in for a JPEG


@pytest.fixture()
def api(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app import settings
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "review-secret")
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("insert into school(id, name, district) values ('sch_c', 'Code School', 'Test') on conflict do nothing")
        con.execute("insert into join_code(code, school_id, role, class_code) values ('CODE-CLS', 'sch_c', 'student', 'CODE-CLS') "
                    "on conflict do nothing")
    from app.main import app
    return TestClient(app)


def sign_up(api, login, role, name, device, **extra):
    out = api.post("/v2/auth/otp", json={"login": login}).json()
    r = api.post("/v2/auth/verify", json={"login": login, "code": out["demo_code"], "device_id": device,
                                          "role": role, "name": name, "privacy_ok": True, **extra})
    assert r.status_code == 200, r.text
    return r.json()["account"], {"Authorization": f"Bearer {r.json()['token']}"}


def checked(api, th):
    """The teacher sends a proof and the reviewer approves it."""
    r = api.post("/v2/classrooms/verification", headers=th, data={"kind": "tet"}, files={"photo": ("p.jpg", PHOTO, "image/jpeg")})
    assert r.status_code == 200 and r.json()["status"] == "pending", r.text
    acc = api.get("/v2/auth/me", headers=th).json()["id"]
    assert api.post(f"/v2/review/teachers/{acc}", headers=ADMIN, json={"approve": True}).status_code == 200


def test_online_teacher_and_student_need_no_code(api):
    t, _ = sign_up(api, "teach@x.org", "teacher", "Hema", "ph_t")
    s, _ = sign_up(api, "9000000101", "student", "Kavi", "ph_s")
    assert t["school_id"] is None and s["school_id"] is None
    # A code that is typed must still be right.
    out = api.post("/v2/auth/otp", json={"login": "9000000102"}).json()
    r = api.post("/v2/auth/verify", json={"login": "9000000102", "code": out["demo_code"], "device_id": "ph_z",
                                          "role": "student", "name": "Z", "privacy_ok": True, "join_code": "NOPE"})
    assert r.status_code == 400


def test_request_approve_and_sync_into_the_class(api):
    _, th = sign_up(api, "t1@x.org", "teacher", "Hema", "ph_t1")
    made = api.post("/v2/classrooms", headers=th, json={"name": "Spoken English", "state": "Tamil Nadu", "min_age": 14,
                                                         "max_age": 18, "seats": 2, "language": "ta"})
    assert made.status_code == 200, made.text
    room = made.json()["classroom"]
    assert made.json()["account"]["school_id"].startswith("onl_")
    checked(api, th)

    s, sh = sign_up(api, "9000000201", "student", "Meena", "ph_s1")
    # Search: her age and state fit; a 20-year-old is not shown this class.
    found = api.get("/v2/classrooms", headers=sh, params={"age": 16, "state": "tamil nadu"}).json()["classrooms"]
    assert [c["code"] for c in found] == [room["code"]]
    assert api.get("/v2/classrooms", headers=sh, params={"age": 20}).json()["classrooms"] == []

    # The rule is checked on the server too.
    assert api.post(f"/v2/classrooms/{room['code']}/join", headers=sh, json={"age": 20}).status_code == 400
    assert api.post(f"/v2/classrooms/{room['code']}/join", headers=sh, json={"age": 16, "state": "Kerala"}).status_code == 400
    r = api.post(f"/v2/classrooms/{room['code']}/join", headers=sh, json={"age": 16, "state": "Tamil Nadu", "note": "I want to learn"})
    assert r.status_code == 200, r.text
    assert api.post(f"/v2/classrooms/{room['code']}/join", headers=sh, json={"age": 16, "state": "Tamil Nadu"}).status_code == 409

    # Before approval she cannot sync into the class.
    assert api.post("/v2/sync", headers=sh, json={"device_id": "ph_s1"}).status_code == 403

    reqs = api.get(f"/v2/classrooms/{room['code']}/requests", headers=th).json()["requests"]
    assert reqs[0]["name"] == "Meena" and reqs[0]["note"] == "I want to learn"
    assert api.post(f"/v2/classrooms/requests/{reqs[0]['id']}/decide", headers=th, json={"approve": True}).json()["status"] == "approved"

    mine = api.get("/v2/classrooms/requests/mine", headers=sh).json()
    assert mine["requests"][0]["status"] == "approved" and mine["account"]["class_code"] == room["code"]
    assert api.get("/v2/auth/me", headers=sh).json()["class_code"] == room["code"]
    assert api.post("/v2/sync", headers=sh, json={"device_id": "ph_s1"}).status_code == 200


def test_only_the_owner_decides_and_one_class_at_a_time(api):
    _, a = sign_up(api, "ta@x.org", "teacher", "A", "ph_ta")
    _, b = sign_up(api, "tb@x.org", "teacher", "B", "ph_tb")
    ra = api.post("/v2/classrooms", headers=a, json={"name": "Maths A"}).json()["classroom"]["code"]
    rb = api.post("/v2/classrooms", headers=b, json={"name": "Maths B"}).json()["classroom"]["code"]
    checked(api, a)
    checked(api, b)
    _, sh = sign_up(api, "9000000301", "student", "Ravi", "ph_s3")
    api.post(f"/v2/classrooms/{ra}/join", headers=sh, json={"age": 15})
    api.post(f"/v2/classrooms/{rb}/join", headers=sh, json={"age": 15})
    req_a = api.get(f"/v2/classrooms/{ra}/requests", headers=a).json()["requests"][0]["id"]
    # Teacher B cannot see or decide teacher A's requests.
    assert api.get(f"/v2/classrooms/{ra}/requests", headers=b).status_code == 404
    assert api.post(f"/v2/classrooms/requests/{req_a}/decide", headers=b, json={"approve": True}).status_code == 404
    assert api.post(f"/v2/classrooms/requests/{req_a}/decide", headers=a, json={"approve": True}).status_code == 200
    # Her request to B closed itself.
    statuses = {r["code"]: r["status"] for r in api.get("/v2/classrooms/requests/mine", headers=sh).json()["requests"]}
    assert statuses == {ra: "approved", rb: "cancelled"}
    assert api.post(f"/v2/classrooms/{rb}/join", headers=sh, json={"age": 15}).status_code == 409

    # She leaves; she can ask again elsewhere.
    assert api.post("/v2/classrooms/leave", headers=sh).json()["account"]["school_id"] is None
    assert api.post(f"/v2/classrooms/{rb}/join", headers=sh, json={"age": 15}).status_code == 200


def test_full_and_closed_classrooms(api):
    _, th = sign_up(api, "tf@x.org", "teacher", "F", "ph_tf")
    code = api.post("/v2/classrooms", headers=th, json={"name": "Tiny", "seats": 1}).json()["classroom"]["code"]
    checked(api, th)
    for i, phone in enumerate(["9000000401", "9000000402"]):
        _, sh = sign_up(api, phone, "student", f"S{i}", f"ph_f{i}")
        api.post(f"/v2/classrooms/{code}/join", headers=sh, json={"age": 15})
    reqs = api.get(f"/v2/classrooms/{code}/requests", headers=th).json()["requests"]
    ok = [api.post(f"/v2/classrooms/requests/{r['id']}/decide", headers=th, json={"approve": True}).status_code for r in reqs]
    assert sorted(ok) == [200, 409]  # one seat
    api.patch(f"/v2/classrooms/{code}", headers=th, json={"name": "Tiny", "seats": 1, "open": False})
    _, sh = sign_up(api, "9000000403", "student", "Late", "ph_f3")
    assert api.post(f"/v2/classrooms/{code}/join", headers=sh, json={"age": 15}).status_code == 404


def test_school_code_students_cannot_ask_and_cannot_leave_their_school(api):
    _, sh = sign_up(api, "9000000501", "student", "Code Kid", "ph_c", join_code="CODE-CLS")
    _, th = sign_up(api, "tc@x.org", "teacher", "C", "ph_tc")
    code = api.post("/v2/classrooms", headers=th, json={"name": "Extra"}).json()["classroom"]["code"]
    checked(api, th)
    assert api.post(f"/v2/classrooms/{code}/join", headers=sh, json={"age": 15}).status_code == 409
    assert api.post("/v2/classrooms/leave", headers=sh).status_code == 409
    # Students do not make classrooms.
    assert api.post("/v2/classrooms", headers=sh, json={"name": "Mine"}).status_code == 403


def test_unchecked_teachers_are_hidden_until_a_reviewer_approves(api):
    _, th = sign_up(api, "new@x.org", "teacher", "New", "ph_n")
    code = api.post("/v2/classrooms", headers=th, json={"name": "Hidden class"}).json()["classroom"]["code"]
    _, sh = sign_up(api, "9000000601", "student", "Asha", "ph_a")
    assert api.get("/v2/classrooms", headers=sh).json()["classrooms"] == []
    assert api.post(f"/v2/classrooms/{code}/join", headers=sh, json={"age": 15}).status_code == 404
    assert api.get("/v2/classrooms/mine", headers=th).json()["verification"]["status"] == "none"

    # Bad uploads are refused.
    assert api.post("/v2/classrooms/verification", headers=th, data={"kind": "tet"},
                    files={"photo": ("p.txt", b"hello", "text/plain")}).status_code == 400
    # Only reviewers review; a rejection needs a reason, and the teacher sees it.
    api.post("/v2/classrooms/verification", headers=th, data={"kind": "school_id", "note": "Govt HSS"},
             files={"photo": ("p.jpg", PHOTO, "image/jpeg")})
    acc = api.get("/v2/auth/me", headers=th).json()["id"]
    assert api.get("/v2/review/teachers", headers=th).status_code == 401
    waiting = api.get("/v2/review/teachers", headers=ADMIN).json()["teachers"]
    assert [w["account_id"] for w in waiting] == [acc] and waiting[0]["note"] == "Govt HSS"
    assert api.get(f"/v2/review/teachers/{acc}/photo", headers=ADMIN).content == PHOTO
    assert api.post(f"/v2/review/teachers/{acc}", headers=ADMIN, json={"approve": False}).status_code == 400
    assert api.post(f"/v2/review/teachers/{acc}", headers=ADMIN, json={"approve": False, "reason": "Photo is blurred"}).status_code == 200
    state = api.get("/v2/classrooms/verification", headers=th).json()
    assert state == {"status": "rejected", "reason": "Photo is blurred", "doc_kind": "school_id"}
    # The photo is gone once decided.
    assert api.get(f"/v2/review/teachers/{acc}/photo", headers=ADMIN).status_code == 404

    # She sends a clearer one; approved; now students see and can join her class.
    checked(api, th)
    assert [c["code"] for c in api.get("/v2/classrooms", headers=sh).json()["classrooms"]] == [code]
    assert api.post(f"/v2/classrooms/{code}/join", headers=sh, json={"age": 15}).status_code == 200


def test_school_code_teachers_need_no_extra_check(api, pg):
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("insert into join_code(code, school_id, role, class_code) values ('CODE-TCH', 'sch_c', 'teacher', 'CODE-CLS') "
                    "on conflict do nothing")
    _, th = sign_up(api, "school@x.org", "teacher", "Sch", "ph_sc", join_code="CODE-TCH")
    assert api.get("/v2/classrooms/verification", headers=th).json()["status"] == "by_school"
    made = api.post("/v2/classrooms", headers=th, json={"name": "School extra"}).json()
    code = made["classroom"]["code"]
    # The online classroom gets its own online school, separate from sch_c
    assert made["classroom"]["online"] is True
    _, sh = sign_up(api, "9000000701", "student", "B", "ph_b")
    assert code in [c["code"] for c in api.get("/v2/classrooms", headers=sh).json()["classrooms"]]

    # School-only course & job posted by the teacher are hidden from online-classroom students
    sc = api.post("/v2/courses", headers=th, json={"title": "School internal", "skill_id": "sk_basic_math",
                                                   "plan": "free", "open_to_all": False}).json()["id"]
    api.post(f"/v2/courses/{sc}/modules", headers=th, json={"title": "M1", "body": "hi"})
    api.post(f"/v2/courses/{sc}/publish", headers=th)
    sp = api.post("/v2/postings", headers=th, json={"kind": "internship", "title": "School lab", "org": "Code School"}).json()["id"]

    # Approve online student B into the teacher's online classroom
    api.post(f"/v2/classrooms/{code}/join", headers=sh, json={"age": 15})
    req_id = api.get(f"/v2/classrooms/{code}/requests", headers=th).json()["requests"][0]["id"]
    api.post(f"/v2/classrooms/requests/{req_id}/decide", headers=th, json={"approve": True})

    # B is in the online school (onl_...), NOT sch_c, so she cannot see sch_c's internal course or posting
    b_acc = api.get("/v2/auth/me", headers=sh).json()
    assert b_acc["school_kind"] == "online" and b_acc["school_id"] != "sch_c"
    assert sc not in [c["id"] for c in api.get("/v2/courses", headers=sh).json()["courses"]]
    assert sp not in [p["id"] for p in api.get("/v2/postings", headers=sh).json()["postings"]]

    # B syncs into the online classroom; teacher sees her in cohort, then B leaves and disappears from teacher's cohort
    assert api.post("/v1/sync", headers=sh, json={
        "students": [{"id": "st_onl_b", "name": "B", "facilitator_code": code, "cards": {}, "answers": {}, "factAnswers": {}, "updated_at": 1763000000000}],
        "actions": [], "pull": ["st_onl_b"],
    }).status_code == 200
    assert [s["id"] for s in api.get(f"/v1/facilitator/{code}/cohort", headers=th).json()["students"]] == ["st_onl_b"]
    assert api.post("/v2/classrooms/leave", headers=sh).status_code == 200
    assert api.get(f"/v1/facilitator/{code}/cohort", headers=th).json()["students"] == []
