"""Sign-in with phone or email and a one-time code; roles; privacy of the login itself."""
import psycopg
import pytest
from fastapi.testclient import TestClient

import add_join_code  # noqa: F401  (conftest puts scripts/ on the path)


@pytest.fixture()
def api(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("insert into school(id, name, district) values ('sch_acc', 'Acc School', 'Test') on conflict do nothing")
        con.execute("insert into join_code(code, school_id, role, class_code) values ('CLS-1', 'sch_acc', 'student', 'CLS-1'), "
                    "('TCH-SECRET', 'sch_acc', 'teacher', 'CLS-1') on conflict do nothing")
    from app.main import app
    return TestClient(app)


def sign_in(api, login, device="ph_1", **extra):
    out = api.post("/v2/auth/otp", json={"login": login}).json()
    return api.post("/v2/auth/verify", json={"login": login, "code": out["demo_code"], "device_id": device, **extra})


def test_student_signs_up_and_in(api, pg):
    r = sign_in(api, "+91 98765 43210", role="student", name="Meena", join_code="cls-1", privacy_ok=True)
    assert r.status_code == 200, r.text
    acc = r.json()["account"]
    assert acc["role"] == "student" and acc["school_id"] == "sch_acc" and acc["login"] == "98•••••210"
    tok = r.json()["token"]
    assert api.get("/v2/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()["name"] == "Meena"
    # Second time: no sign-up details needed; same account.
    again = sign_in(api, "9876543210", device="ph_2")
    assert again.status_code == 200 and again.json()["account"]["id"] == acc["id"]
    # The number itself is not stored anywhere readable.
    with psycopg.connect(pg) as con:
        dump = str(con.execute("select * from account").fetchall())
    assert "9876543210" not in dump


def test_role_comes_from_the_code(api):
    r = sign_in(api, "a@school.in", role="teacher", name="Ravi", join_code="CLS-1", privacy_ok=True)
    assert r.status_code == 400
    r = sign_in(api, "a@school.in", role="teacher", name="Ravi", join_code="TCH-SECRET", privacy_ok=True)
    assert r.json()["account"]["role"] == "teacher"


def test_wrong_class_code_keeps_the_sign_in_code(api):
    out = api.post("/v2/auth/otp", json={"login": "9111111111"}).json()
    body = {"login": "9111111111", "code": out["demo_code"], "device_id": "ph_k", "role": "student",
            "name": "Kavi", "privacy_ok": True}
    r = api.post("/v2/auth/verify", json={**body, "join_code": "DEMO-XXXXX"})
    assert r.status_code == 400 and "class code" in r.json()["detail"]
    # Same 6-digit code, right class code: works.
    r = api.post("/v2/auth/verify", json={**body, "join_code": "CLS-1"})
    assert r.status_code == 200, r.text
    # Now it is used up.
    assert api.post("/v2/auth/verify", json={**body, "join_code": "CLS-1"}).status_code == 400


def test_refused_forms_still_run_out(api):
    out = api.post("/v2/auth/otp", json={"login": "9222222222"}).json()
    body = {"login": "9222222222", "code": out["demo_code"], "device_id": "ph_g", "role": "teacher",
            "name": "G", "privacy_ok": True, "join_code": "GUESS"}
    for _ in range(5):
        assert api.post("/v2/auth/verify", json=body).status_code == 400
    r = api.post("/v2/auth/verify", json={**body, "join_code": "TCH-SECRET"})
    assert "expired" in r.json()["detail"]


def test_donor_sees_no_students(api):
    r = sign_in(api, "donor@fund.org", role="funder", name="Asha", org="Fund", privacy_ok=True)
    tok = r.json()["token"]
    assert r.json()["account"]["school_id"] is None
    assert api.post("/v2/sync", json={"device_id": "ph_1"}, headers={"Authorization": f"Bearer {tok}"}).status_code == 403


def test_wrong_codes_run_out(api):
    api.post("/v2/auth/otp", json={"login": "9000000001"})
    for _ in range(5):
        r = api.post("/v2/auth/verify", json={"login": "9000000001", "code": "000000", "device_id": "ph_x"})
        assert r.status_code == 400
    assert "expired" in r.json()["detail"] or "Too many" in r.json()["detail"]
    r = api.post("/v2/auth/verify", json={"login": "9000000001", "code": "000000", "device_id": "ph_x"})
    assert "expired" in r.json()["detail"]


def test_new_account_needs_privacy_ok_and_bad_logins_refused(api):
    assert sign_in(api, "9123456780", role="employer", name="Shop").status_code == 400
    assert api.post("/v2/auth/otp", json={"login": "12345"}).status_code == 400
    assert api.post("/v2/auth/otp", json={"login": "not-an-email@"}).status_code == 400


def test_logout_kills_token(api):
    tok = sign_in(api, "e@x.org", role="employer", name="Shop", privacy_ok=True).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert api.post("/v2/auth/logout", headers=h).status_code == 200
    assert api.get("/v2/auth/me", headers=h).status_code == 401


def test_modes_link_school_and_student_isolation(api):
    # mode='school' requires a code
    assert sign_in(api, "t_req@school.in", role="teacher", mode="school", name="Req", privacy_ok=True).status_code == 400
    # mode='online' signs up without a school
    r_onl = sign_in(api, "t_onl@x.in", device="ph_to", role="teacher", mode="online", name="Onl", privacy_ok=True)
    assert r_onl.status_code == 200 and r_onl.json()["account"]["school_kind"] is None
    th_onl = {"Authorization": f"Bearer {r_onl.json()['token']}"}
    # Online teacher can link a school code later
    assert api.post("/v2/auth/me/school", headers=th_onl, json={"join_code": "CLS-1"}).status_code == 400
    linked = api.post("/v2/auth/me/school", headers=th_onl, json={"join_code": "TCH-SECRET"})
    assert linked.status_code == 200 and linked.json()["account"]["school_kind"] == "school"

    # Two students in the same school cannot read or claim each other's profiles
    s1 = sign_in(api, "9000000801", device="ph_s1", role="student", mode="school", name="S1", join_code="CLS-1", privacy_ok=True).json()
    s2 = sign_in(api, "9000000802", device="ph_s2", role="student", mode="school", name="S2", join_code="CLS-1", privacy_ok=True).json()
    h1 = {"Authorization": f"Bearer {s1['token']}"}
    h2 = {"Authorization": f"Bearer {s2['token']}"}
    assert s1["account"]["school_kind"] == "school" and s1["account"]["school_name"] == "Acc School"

    consent = {"id": "c_1", "scopes": ["assess"], "method": "paper_form", "granted_at": 1763000000000}
    assert api.post("/v2/sync", headers=h1, json={
        "device_id": "ph_s1",
        "students": [{"id": "stu_1", "name": "S1", "facilitator_code": "CLS-1", "consent": consent}],
        "events": [{"id": "01KA0000000000000000000010", "student_id": "stu_1", "device_id": "ph_s1",
                    "kind": "self_report", "skill_id": "sk_stitching", "payload": {"source": "tap"}, "created_at": 1763000000000}],
    }).status_code == 200
    assert api.post("/v2/auth/me/student", headers=h1, json={"student_id": "stu_1"}).status_code == 200
    assert api.post("/v2/auth/me/student", headers=h2, json={"student_id": "stu_1"}).status_code == 409

    # S2 has her own profile stu_2 and cannot access stu_1's docs, applications, or synced events
    assert api.post("/v2/auth/me/student", headers=h2, json={"student_id": "stu_2"}).status_code == 200
    assert api.get("/v2/docs/stu_1", headers=h2).status_code == 403
    assert api.get("/v2/applications/student/stu_1", headers=h2).status_code == 403
    pulled = api.post("/v2/sync", headers=h2, json={"device_id": "ph_s2", "student_ids": ["stu_1"], "cursor": 0}).json()
    assert pulled["events"] == []

    # S1 signing in on a second phone restores her profile via /v2/auth/me/profile
    again = sign_in(api, "9000000801", device="ph_s1_new").json()
    prof = api.get("/v2/auth/me/profile", headers={"Authorization": f"Bearer {again['token']}"}).json()
    assert prof["student"]["id"] == "stu_1" and len(prof["events"]) == 1


def test_one_student_account_holds_up_to_three_profiles(api, pg):
    """A student account may hold up to STUDENT_PROFILES_MAX (3) profiles; a 4th, or another account's, is refused."""
    me = sign_in(api, "9000000901", device="ph_m", role="student", mode="school", name="Meena", join_code="CLS-1", privacy_ok=True).json()
    other = sign_in(api, "9000000902", device="ph_o", role="student", mode="school", name="Other", join_code="CLS-1", privacy_ok=True).json()
    h, ho = {"Authorization": f"Bearer {me['token']}"}, {"Authorization": f"Bearer {other['token']}"}
    consent = {"id": "c_m", "scopes": ["assess"], "method": "paper_form", "granted_at": 1763000000000}

    def sync(headers, device, sid):
        return api.post("/v2/sync", headers=headers, json={
            "device_id": device, "students": [{"id": sid, "name": sid, "facilitator_code": "CLS-1", "consent": {**consent, "id": f"c_{sid}"}}],
            "events": [{"id": f"01KA00000000000000000009{'ABCD'.index(sid[-1].upper())}0", "student_id": sid, "device_id": device, "kind": "self_report",
                        "skill_id": "sk_stitching", "payload": {"source": "tap"}, "created_at": 1763000000000}]})

    for sid in ("stu_pa", "stu_pb", "stu_pc"):
        assert sync(h, "ph_m", sid).status_code == 200
    acc = api.get("/v2/auth/me", headers=h).json()
    assert acc["student_ids"] == ["stu_pa", "stu_pb", "stu_pc"] and acc["student_id"] == "stu_pa"
    assert acc["student_profiles_max"] == 3
    # a 4th profile is refused, by sync and by the link endpoint
    sync(h, "ph_m", "stu_pd")
    assert "stu_pd" not in api.get("/v2/auth/me", headers=h).json()["student_ids"]
    assert api.post("/v2/auth/me/student", headers=h, json={"student_id": "stu_pd"}).status_code == 409
    # her own profiles are open to her; another account cannot take or read them
    assert api.get("/v2/docs/stu_pb", headers=h).status_code != 403
    assert api.get("/v2/docs/stu_pb", headers=ho).status_code == 403
    assert api.post("/v2/auth/me/student", headers=ho, json={"student_id": "stu_pc"}).status_code == 409
    # signing in on a new phone restores each profile, including a later one
    again = sign_in(api, "9000000901", device="ph_m2").json()
    h2 = {"Authorization": f"Bearer {again['token']}"}
    assert api.get("/v2/auth/me/profile?student_id=stu_pc", headers=h2).json()["student"]["id"] == "stu_pc"
    assert api.get("/v2/auth/me/profile", headers=h2).json()["student"]["id"] == "stu_pa"
    assert api.get("/v2/auth/me/profile?student_id=stu_pd", headers=h2).json()["student"] is None  # not hers
    # erasing a profile also removes its link, so there is room again
    assert api.request("DELETE", "/v2/student/stu_pa", headers=h, json={"confirmed_by": "guardian"}).json()["deleted"] is True
    after = api.get("/v2/auth/me", headers=h).json()
    assert after["student_ids"] == ["stu_pb", "stu_pc"] and after["student_id"] == "stu_pb"
