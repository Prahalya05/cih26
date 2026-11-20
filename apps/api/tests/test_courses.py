"""Teacher profiles, courses, the access rule, demo and Razorpay payments, server-marked quizzes."""
import hashlib
import hmac

import psycopg
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def api(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("RAZORPAY_KEY_ID", raising=False)
    monkeypatch.delenv("RAZORPAY_KEY_SECRET", raising=False)
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("insert into school(id, name, district) values ('sch_c', 'C School', 'Salem') on conflict do nothing")
        con.execute("insert into join_code(code, school_id, role, class_code) values ('CLS-C', 'sch_c', 'student', 'CLS-C'), "
                    "('TCH-C', 'sch_c', 'teacher', 'CLS-C') on conflict do nothing")
    from app.main import app
    return TestClient(app)


def token(api, login, device, **extra):
    code = api.post("/v2/auth/otp", json={"login": login}).json()["demo_code"]
    r = api.post("/v2/auth/verify", json={"login": login, "code": code, "device_id": device, "privacy_ok": True, **extra})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def course(api):
    t = token(api, "t@c.in", "ph_t", role="teacher", name="Lakshmi", join_code="TCH-C")
    s = token(api, "9000000020", "ph_s", role="student", name="Meena", join_code="CLS-C")
    assert api.put("/v2/teachers/me/profile", headers=t, json={"bio": "Tailor for 12 years", "subjects": ["Tailoring"], "years": 12}).status_code == 200
    c = api.post("/v2/courses", headers=t, json={"title": "Blouse stitching", "skill_id": "ss_stitch_machine", "plan": "per_module", "price_inr": 49}).json()
    q = [{"q": "Which stitch is for hems?", "options": ["Straight", "Blind"], "answer": 1}]
    for i in range(3):
        assert api.post(f"/v2/courses/{c['id']}/modules", headers=t, json={"title": f"Lesson {i}", "body": "Read this", "quiz": q}).status_code == 200
    assert api.post(f"/v2/courses/{c['id']}/publish", headers=t).status_code == 200
    return {"t": t, "s": s, "id": c["id"]}


def test_access_rule_and_demo_payment(api, course):
    s = course["s"]
    d = api.get(f"/v2/courses/{course['id']}", headers=s).json()
    assert [x["open"] for x in d["lessons"]] == [True, False, False]  # first lesson is a free preview
    assert "body" not in d["lessons"][1] and "answers" not in d["lessons"][0]
    assert all("answer" not in q for q in d["lessons"][0]["quiz"])
    locked = d["lessons"][1]["id"]
    assert api.post(f"/v2/modules/{locked}/quiz", headers=s, json={"answers": [1]}).status_code == 403
    pay = api.post(f"/v2/courses/{course['id']}/checkout", headers=s, json={"module_id": locked}).json()
    assert pay["provider"] == "demo" and pay["amount_inr"] == 49
    # still locked until paid
    assert api.get(f"/v2/courses/{course['id']}", headers=s).json()["lessons"][1]["open"] is False
    assert api.post(f"/v2/payments/{pay['purchase_id']}/demo-pay", headers=s).json()["status"] == "paid"
    d = api.get(f"/v2/courses/{course['id']}", headers=s).json()
    assert [x["open"] for x in d["lessons"]] == [True, True, False]
    r = api.post(f"/v2/modules/{locked}/quiz", headers=s, json={"answers": [1]}).json()
    assert r["passed"] and r["evidence"] == {"subskill_id": "ss_stitch_machine", "score": 1.0}
    mine = api.get("/v2/courses/mine", headers=course["t"]).json()
    assert mine["courses"][0]["gross"] == 49 and mine["courses"][0]["earned_inr"] == 44


def test_subscription(api, course):
    t, s = course["t"], course["s"]
    c = api.post("/v2/courses", headers=t, json={"title": "Monthly maths", "skill_id": "sk_basic_math", "plan": "subscription", "price_inr": 99, "open_to_all": True}).json()
    for i in range(2):
        api.post(f"/v2/courses/{c['id']}/modules", headers=t, json={"title": f"L{i}", "body": "x"})
    api.post(f"/v2/courses/{c['id']}/publish", headers=t)
    pay = api.post(f"/v2/courses/{c['id']}/checkout", headers=s, json={}).json()
    out = api.post(f"/v2/payments/{pay['purchase_id']}/demo-pay", headers=s).json()
    assert out["valid_until"]
    assert all(x["open"] for x in api.get(f"/v2/courses/{c['id']}", headers=s).json()["lessons"])
    # Teachers cannot buy; a student cannot pay someone else's purchase
    assert api.post(f"/v2/courses/{c['id']}/checkout", headers=t, json={}).status_code == 403


def test_razorpay_signature_checked(api, course, monkeypatch):
    from app.adapters import razorpay
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_x")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret_x")
    n = iter(range(1, 10))
    monkeypatch.setattr(razorpay, "create_order", lambda amount, receipt, notes: {"id": f"order_T{next(n)}"})
    s = course["s"]
    locked = api.get(f"/v2/courses/{course['id']}", headers=s).json()["lessons"][2]["id"]
    pay = api.post(f"/v2/courses/{course['id']}/checkout", headers=s, json={"module_id": locked}).json()
    assert pay["provider"] == "razorpay" and pay["key_id"] == "rzp_test_x"
    bad = {"purchase_id": pay["purchase_id"], "razorpay_order_id": "order_T1", "razorpay_payment_id": "pay_1", "razorpay_signature": "nope"}
    assert api.post("/v2/payments/verify", headers=s, json=bad).status_code == 400
    assert api.post(f"/v2/payments/{pay['purchase_id']}/demo-pay", headers=s).status_code == 404
    pay = api.post(f"/v2/courses/{course['id']}/checkout", headers=s, json={"module_id": locked}).json()
    assert pay["order_id"] == "order_T2"
    sig = hmac.new(b"secret_x", b"order_T2|pay_2", hashlib.sha256).hexdigest()
    good = {"purchase_id": pay["purchase_id"], "razorpay_order_id": "order_T2", "razorpay_payment_id": "pay_2", "razorpay_signature": sig}
    assert api.post("/v2/payments/verify", headers=s, json=good).json()["status"] == "paid"
    assert api.get(f"/v2/courses/{course['id']}", headers=s).json()["lessons"][2]["open"] is True


def test_teacher_profile_public(api, course):
    p = api.get("/v2/teachers", headers=course["s"]).json()["teachers"]
    assert p[0]["name"] == "Lakshmi" and p[0]["courses"] == 1
    prof = api.get(f"/v2/teachers/{p[0]['id']}", headers=course["s"]).json()
    assert prof["bio"] == "Tailor for 12 years" and prof["school"] == "C School" and len(prof["courses"]) == 1
