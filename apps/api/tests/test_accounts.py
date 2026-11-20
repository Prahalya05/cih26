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
