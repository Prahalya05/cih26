"""Paid jobs: one-time buyer link, confirmation becomes a rating event that reaches the phone."""
import pytest
from phones import PhoneClient
from fastapi.testclient import TestClient

NOW = 1763000000000
ORDER_ID = "01KA0000000000000000000001"


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app.main import app
    c = PhoneClient(app, pg)
    c.post("/v2/sync", json={"device_id": "phoneA", "students": [
        {"id": "st1", "name": "Meena Kumari", "consent": {"id": "c1", "scopes": ["assess"], "method": "paper_form", "granted_at": NOW}}],
        "events": [{"id": ORDER_ID, "student_id": "st1", "device_id": "phoneA", "kind": "order", "skill_id": "sk_stitching",
                    "payload": {"amount_inr": 350, "what": "Blouse"}, "created_at": NOW}]})
    return c


def test_buyer_confirms_once_and_phone_receives_it(client):
    token = client.post(f"/v2/orders/{ORDER_ID}/link").json()["token"]
    assert client.post(f"/v2/orders/{ORDER_ID}/link").json()["token"] == token  # same link until used
    info = client.get(f"/v2/confirm/{token}").json()
    assert info["student"] == "Meena" and info["amount_inr"] == 350 and info["what"] == "Blouse"
    assert client.post(f"/v2/confirm/{token}", json={"on_time": True, "quality": True, "rehire": True}).json() == {"ok": True}
    assert client.post(f"/v2/confirm/{token}", json={"on_time": True, "quality": True, "rehire": True}).status_code == 410
    back = client.post("/v2/sync", json={"device_id": "phoneA", "student_ids": ["st1"], "cursor": 0}).json()
    rating = [e for e in back["events"] if e["kind"] == "rating"]
    assert len(rating) == 1 and rating[0]["refers_to"] == ORDER_ID and rating[0]["payload"]["rehire"] is True


def test_unknown_links(client):
    assert client.get("/v2/confirm/nope").status_code == 404
    assert client.post("/v2/orders/01KA0000000000000000000099/link").status_code == 404


def test_confirmed_order_raises_the_level(client):
    from app import db
    token = client.post(f"/v2/orders/{ORDER_ID}/link").json()["token"]
    with db.connect() as con:
        before = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id='st1'")}
    client.post(f"/v2/confirm/{token}", json={"on_time": True, "quality": True, "rehire": True})
    with db.connect() as con:
        after = {r["subskill_id"]: r["p_level"] for r in con.execute("select * from skill_state where student_id='st1'")}
    assert after["ss_stitch_machine"][3] > before["ss_stitch_machine"][3]
