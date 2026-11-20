"""Job posts, applications with document rules, teacher document checks, donor pay check, customer privacy."""
import psycopg
import pytest
from fastapi.testclient import TestClient

NOW = 1763000000000
CONSENT = {"id": "c_t1", "scopes": ["assess", "photos", "share_portfolio"], "method": "paper_form", "granted_at": NOW}


@pytest.fixture()
def api(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("insert into school(id, name, district) values ('sch_t', 'T School', 'Salem') on conflict do nothing")
        con.execute("insert into join_code(code, school_id, role, class_code) values ('CLS-T', 'sch_t', 'student', 'CLS-T'), "
                    "('TCH-T', 'sch_t', 'teacher', 'CLS-T') on conflict do nothing")
    from app.main import app
    return TestClient(app)


def token(api, login, device, **extra):
    code = api.post("/v2/auth/otp", json={"login": login}).json()["demo_code"]
    r = api.post("/v2/auth/verify", json={"login": login, "code": code, "device_id": device, "privacy_ok": True, **extra})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def people(api):
    s = token(api, "9000000010", "ph_s", role="student", name="Meena", join_code="CLS-T")
    t = token(api, "t@school.in", "ph_t", role="teacher", name="Ravi", join_code="TCH-T")
    e = token(api, "hr@shop.in", "ph_e", role="employer", name="Shop HR", org="Shop")
    f = token(api, "f@fund.org", "ph_f", role="funder", name="Fund", org="Fund")
    r = api.post("/v2/sync", headers=s, json={"device_id": "ph_s", "students": [{"id": "stu1", "name": "Meena K", "consent": CONSENT}]})
    assert r.status_code == 200, r.text
    return {"s": s, "t": t, "e": e, "f": f}


def test_posting_visibility_and_roles(api, people):
    r = api.post("/v2/postings", headers=people["e"], json={"kind": "internship", "title": "Tailoring intern", "org": "Shop"})
    assert r.status_code == 200, r.text
    tp = api.post("/v2/postings", headers=people["t"], json={"kind": "job", "title": "Lab helper", "org": "School"}).json()
    assert api.post("/v2/postings", headers=people["s"], json={"kind": "job", "title": "x y z", "org": "me"}).status_code == 403
    seen = {p["id"] for p in api.get("/v2/postings", headers=people["s"]).json()["postings"]}
    assert r.json()["id"] in seen and tp["id"] in seen
    # Another school's teacher post is not visible to the employer
    assert tp["id"] not in {p["id"] for p in api.get("/v2/postings", headers=people["e"]).json()["postings"]}


def test_apply_needs_verified_documents(api, people):
    post = api.post("/v2/postings", headers=people["e"], json={"kind": "internship", "title": "Tailoring intern", "org": "Shop"}).json()
    body = {"student_id": "stu1", "opportunity_id": post["id"], "kind": "internship", "readiness": "ready",
            "resume": {"source": "disha", "first_name": "Meena", "skills": [{"id": "sk_stitching", "level": 3}]}}
    r = api.post("/v2/applications", headers=people["s"], json=body)
    assert r.status_code == 409 and r.json()["detail"]["missing"] == ["id_proof"]
    # The teacher saw her ID card.
    assert api.post("/v2/docs/verify", headers=people["t"], json={"student_id": "stu1", "kind": "id_proof", "ok": True}).status_code == 200
    assert api.post("/v2/docs/verify", headers=people["s"], json={"student_id": "stu1", "kind": "id_proof", "ok": True}).status_code == 403
    assert api.post("/v2/applications", headers=people["s"], json=body).status_code == 200
    got = api.get("/v2/applications/received", headers=people["e"]).json()["applications"]
    assert len(got) == 1 and got[0]["resume"]["first_name"] == "Meena"
    assert api.patch(f"/v2/applications/{got[0]['id']}", headers=people["e"], json={"status": "shortlisted"}).status_code == 200
    mine = api.get("/v2/applications/student/stu1", headers=people["s"]).json()["applications"]
    assert mine[0]["status"] == "shortlisted"
    assert api.post("/v2/applications", headers=people["s"], json={**body, "readiness": "later"}).status_code == 409


def test_donor_paycheck_is_anonymous_and_needs_verified_need(api, people):
    r = api.get("/v2/funder/paycheck", headers=people["f"])
    assert r.status_code == 200
    assert api.get("/v2/funder/paycheck", headers=people["t"]).status_code == 403
    assert "Meena" not in r.text and "stu1" not in r.text


def test_override_needs_a_reason():
    from app.schemas import validate_event
    e = {"id": "01KA0000000000000000000001", "student_id": "s", "device_id": "d", "kind": "rating", "skill_id": "sk_stitching",
         "rater_id": "r", "payload": {"level": 3, "override": True, "reason": "ok"}, "created_at": NOW}
    assert validate_event(e, NOW)
    e["payload"]["reason"] = "I watched her stitch a blouse in class"
    assert validate_event(e, NOW) == []
