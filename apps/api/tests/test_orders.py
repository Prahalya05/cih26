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


def test_legacy_path_token_routes_removed(client):
    token = client.post(f"/v2/orders/{ORDER_ID}/link", headers={"user-agent": "StudentPhone/1.0"}).json()["token"]
    assert client.get(f"/v2/confirm/{token}").status_code in (404, 405)
    assert client.post(f"/v2/confirm/{token}", json={"on_time": True, "quality": True, "rehire": True}).status_code in (404, 405)


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


def test_self_confirm_from_different_browser_without_otp_capped_below_level_4(client):
    from app import db
    token = client.post(f"/v2/orders/{ORDER_ID}/link", headers={"user-agent": "StudentPhone/1.0"}).json()["token"]
    res = client.post("/v2/confirm", json={"token": token, "on_time": True, "quality": True, "rehire": True},
                      headers={"user-agent": "IncognitoBrowser/99.0"})
    assert res.status_code == 200
    assert res.json()["buyer_phone_verified"] is False
    with db.connect() as con:
        state = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id='st1'")}
    assert state["ss_stitch_machine"][3] <= 0.4 + 1e-9


def test_high_value_order_requires_buyer_otp_and_unlocks_level_4(client):
    from app import db
    high_id = "01KA0000000000000000000002"
    client.post("/v2/sync", json={"device_id": "phoneA", "events": [
        {"id": high_id, "student_id": "st1", "device_id": "phoneA", "kind": "order", "skill_id": "sk_stitching",
         "payload": {"amount_inr": 750, "what": "Bridal blouse"}, "created_at": NOW + 10}]})
    ua = {"user-agent": "SharedSchoolWiFi/1.0"}
    token = client.post(f"/v2/orders/{high_id}/link", headers=ua).json()["token"]
    info = client.post("/v2/confirm/info", json={"token": token}, headers=ua).json()
    assert info["otp_required"] is True
    # Cannot confirm without OTP above threshold
    assert client.post("/v2/confirm", json={"token": token, "on_time": True, "quality": True, "rehire": True},
                       headers=ua).status_code == 400
    # Shared network + verified OTP succeeds and is not flagged unverified
    otp = client.post("/v2/confirm/otp", json={"token": token, "phone": "9876543210"}, headers=ua).json()
    res = client.post("/v2/confirm",
                      json={"token": token, "on_time": True, "quality": True, "rehire": True, "otp_code": otp["demo_code"]},
                      headers=ua)
    assert res.status_code == 200
    assert res.json() == {"ok": True, "unverified": False, "buyer_phone_verified": True}
    with db.connect() as con:
        state = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id='st1'")}
    assert state["ss_stitch_machine"][3] > 0.4


def test_teacher_verify_bypass_audit_and_caps(client):
    from app import db
    from app.routers import v2
    # Student phone cannot call teacher-verify
    r_stud = client.post(f"/v2/orders/{ORDER_ID}/teacher-verify",
                         json={"method": "phoned buyer", "reason": "Spoke to neighbour who bought blouse"})
    assert r_stud.status_code == 403

    t_hdr = client.as_phone("phoneT")
    # Teacher phone from same school succeeds and unlocks Level 4 evidence weight
    r_teach = client.post(f"/v2/orders/{ORDER_ID}/teacher-verify",
                          json={"method": "phoned buyer", "reason": "Spoke to neighbour who bought blouse"},
                          headers=t_hdr)
    assert r_teach.status_code == 200 and r_teach.json() == {"ok": True}
    with db.connect() as con:
        after = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id='st1'")}
    assert after["ss_stitch_machine"][3] > 0.1

    # Audit endpoint returns stored method and reason
    audit = client.get("/v2/orders/teacher-verifications", headers=t_hdr)
    assert audit.status_code == 200
    items = audit.json()["verifications"]
    assert len(items) == 1
    assert items[0]["method"] == "phoned buyer"
    assert items[0]["reason"] == "Spoke to neighbour who bought blouse"

    # Per-student cap (2) enforced
    o2 = "01KA0000000000000000000012"
    o3 = "01KA0000000000000000000013"
    client.post("/v2/sync", json={"device_id": "phoneA", "events": [
        {"id": o2, "student_id": "st1", "device_id": "phoneA", "kind": "order", "skill_id": "sk_stitching",
         "payload": {"amount_inr": 200, "what": "Alteration"}, "created_at": NOW + 20},
        {"id": o3, "student_id": "st1", "device_id": "phoneA", "kind": "order", "skill_id": "sk_stitching",
         "payload": {"amount_inr": 200, "what": "Hemming"}, "created_at": NOW + 30},
    ]})
    assert client.post(f"/v2/orders/{o2}/teacher-verify",
                       json={"method": "visited", "reason": "Saw buyer wearing blouse"}, headers=t_hdr).status_code == 200
    assert client.post(f"/v2/orders/{o3}/teacher-verify",
                       json={"method": "saw the product", "reason": "Checked finished hem"}, headers=t_hdr).status_code == 429

    # Per-teacher weekly cap enforced across students
    st2_orders = [{"id": f"01KA000000000000000000002{i}", "student_id": "st2", "device_id": "phoneA",
                   "kind": "order", "skill_id": "sk_stitching", "payload": {"amount_inr": 100, "what": f"Job {i}"},
                   "created_at": NOW + 40 + i} for i in range(v2.MAX_TEACHER_VERIFIES_PER_WEEK)]
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [
        {"id": "st2", "name": "Kavya", "consent": {"id": "c2", "scopes": ["assess"], "method": "paper_form", "granted_at": NOW}}],
        "events": st2_orders})
    # Force per-student cap high enough to hit weekly cap
    original_cap = v2.MAX_TEACHER_VERIFIES_PER_STUDENT
    v2.MAX_TEACHER_VERIFIES_PER_STUDENT = 50
    try:
        hit_429 = False
        for ev in st2_orders:
            r = client.post(f"/v2/orders/{ev['id']}/teacher-verify",
                            json={"method": "visited", "reason": "Verified in person"}, headers=t_hdr)
            if r.status_code == 429:
                hit_429 = True
                break
        assert hit_429
    finally:
        v2.MAX_TEACHER_VERIFIES_PER_STUDENT = original_cap


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
