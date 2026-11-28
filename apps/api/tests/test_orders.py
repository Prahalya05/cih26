"""Paid jobs: one-time buyer link, anti-self-confirm, teacher bypass, buyer phone OTP, and rate limits."""
import pytest
from phones import PhoneClient

NOW = 1763000000000
ORDER_ID = "01KA0000000000000000000001"


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("OTP_DEMO", "1")
    from app.main import app
    from app import ratelimit
    ratelimit.reset()
    c = PhoneClient(app, pg)
    c.post("/v2/sync", json={"device_id": "phoneA", "students": [
        {"id": "st1", "name": "Meena Kumari", "consent": {"id": "c1", "scopes": ["assess"], "method": "paper_form", "granted_at": NOW}}],
        "events": [{"id": ORDER_ID, "student_id": "st1", "device_id": "phoneA", "kind": "order", "skill_id": "sk_stitching",
                    "payload": {"amount_inr": 350, "what": "Blouse"}, "created_at": NOW}]})
    return c


def test_buyer_confirms_once_via_body_and_phone_receives_it(client):
    token = client.post(f"/v2/orders/{ORDER_ID}/link", headers={"user-agent": "StudentPhone/1.0"}).json()["token"]
    assert client.post(f"/v2/orders/{ORDER_ID}/link", headers={"user-agent": "StudentPhone/1.0"}).json()["token"] == token
    info = client.post("/v2/confirm/info", json={"token": token}, headers={"user-agent": "BuyerPhone/2.0"}).json()
    assert info["student"] == "Meena" and info["amount_inr"] == 350 and info["what"] == "Blouse"
    res = client.post("/v2/confirm", json={"token": token, "on_time": True, "quality": True, "rehire": True},
                      headers={"user-agent": "BuyerPhone/2.0"}).json()
    assert res == {"ok": True, "unverified": False, "buyer_phone_verified": False}
    assert client.post("/v2/confirm", json={"token": token, "on_time": True, "quality": True, "rehire": True},
                       headers={"user-agent": "BuyerPhone/2.0"}).status_code == 410
    back = client.post("/v2/sync", json={"device_id": "phoneA", "student_ids": ["st1"], "cursor": 0}).json()
    rating = [e for e in back["events"] if e["kind"] == "rating"]
    assert len(rating) == 1 and rating[0]["refers_to"] == ORDER_ID and rating[0]["payload"]["rehire"] is True


def test_self_confirm_is_flagged_unverified_and_capped_below_level_4(client):
    from app import db
    ua = {"user-agent": "SameDevice/1.0"}
    token = client.post(f"/v2/orders/{ORDER_ID}/link", headers=ua).json()["token"]
    res = client.post("/v2/confirm", json={"token": token, "on_time": True, "quality": True, "rehire": True}, headers=ua)
    assert res.status_code == 200
    assert res.json()["unverified"] is True
    with db.connect() as con:
        state = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id='st1'")}
    assert state["ss_stitch_machine"][3] <= 0.4 + 1e-9


def test_teacher_verify_bypass_and_non_teacher_rejected(client):
    from app import db
    # Student phone cannot call teacher-verify
    r_stud = client.post(f"/v2/orders/{ORDER_ID}/teacher-verify",
                         json={"method": "phoned buyer", "reason": "Spoke to neighbour who bought blouse"})
    assert r_stud.status_code == 403

    # Teacher phone from same school succeeds and unlocks Level 4 evidence weight
    r_teach = client.post(f"/v2/orders/{ORDER_ID}/teacher-verify",
                          json={"method": "phoned buyer", "reason": "Spoke to neighbour who bought blouse"},
                          headers=client.as_phone("phoneT"))
    assert r_teach.status_code == 200 and r_teach.json() == {"ok": True}
    with db.connect() as con:
        after = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id='st1'")}
    assert after["ss_stitch_machine"][3] > 0.1


def test_buyer_phone_otp_stores_only_hmac(client):
    from app import db
    token = client.post(f"/v2/orders/{ORDER_ID}/link", headers={"user-agent": "StudentPhone/1.0"}).json()["token"]
    otp = client.post("/v2/confirm/otp", json={"token": token, "phone": "9876543210"},
                      headers={"user-agent": "BuyerPhone/2.0"}).json()
    assert otp["ok"] is True and len(otp["demo_code"]) == 6
    with db.connect() as con:
        row = con.execute("select buyer_hmac from confirm_token where token = %s", (token,)).fetchone()
        assert row["buyer_hmac"] and "9876543210" not in row["buyer_hmac"]
    res = client.post("/v2/confirm",
                      json={"token": token, "on_time": True, "quality": True, "rehire": True, "otp_code": otp["demo_code"]},
                      headers={"user-agent": "BuyerPhone/2.0"}).json()
    assert res["buyer_phone_verified"] is True


def test_unknown_links(client):
    assert client.post("/v2/confirm/info", json={"token": "nope"}).status_code == 404
    assert client.post("/v2/orders/01KA0000000000000000000099/link").status_code == 404


def test_confirmed_order_raises_the_level(client):
    from app import db
    token = client.post(f"/v2/orders/{ORDER_ID}/link", headers={"user-agent": "StudentPhone/1.0"}).json()["token"]
    with db.connect() as con:
        before = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id='st1'")}
    client.post("/v2/confirm", json={"token": token, "on_time": True, "quality": True, "rehire": True},
                headers={"user-agent": "BuyerPhone/2.0"})
    with db.connect() as con:
        after = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id='st1'")}
    assert after["ss_stitch_machine"][3] > before["ss_stitch_machine"][3]
