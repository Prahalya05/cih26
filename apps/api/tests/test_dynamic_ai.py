"""AI that changes what she sees, inside rules: personal career order + reasons, Talk follow-ups, and the
scheme catalogue the phones fetch. Gemini is stubbed; each test gives it something a rule must reject."""
from __future__ import annotations

import copy

import psycopg
import pytest

from app import kb, settings
from app.adapters import gemini, gemini_tasks
from app.services import guards, schemes
from phones import PhoneClient

SHORT = ["occ_electrician", "occ_fashion_designer", "occ_nurse_anm"]
QUOTES = ["I help my father fix motor pumps", "I love drawing kolams"]


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("DEMO_CACHE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    schemes.catalog(fresh=True)
    from app.main import app
    yield PhoneClient(app, pg)
    # Admin changes must not leak into later tests through the 60 s catalogue cache.
    with psycopg.connect(pg, autocommit=True) as con:
        con.execute("delete from scheme_catalog")
    schemes.catalog(fresh=True)


def test_personal_order_stays_inside_the_shortlist():
    out, dropped = guards.check_personalised({
        "order": ["occ_nurse_anm", "occ_made_up", "occ_nurse_anm", "occ_electrician"],
        "order_reason": "her words",
        "items": [{"id": "occ_electrician", "why": "You fix pumps.", "quote": "fix motor pumps"},
                  {"id": "occ_fashion_designer", "why": "You draw.", "quote": "I design dresses for film stars"},
                  {"id": "occ_made_up", "why": "x", "quote": ""}]}, SHORT, QUOTES)
    assert out["order"] == ["occ_nurse_anm", "occ_electrician", "occ_fashion_designer"]
    assert set(out["why"]) == {"occ_electrician"}
    reasons = {d["reason"] for d in dropped}
    assert "not in the formula's shortlist" in reasons
    assert "quote not found in what she said" in reasons
    assert any("left out by the AI" in r for r in reasons)


def test_followup_rule_blocks_personal_questions():
    assert guards.check_followup({"question": "What do you like doing after school"}) == ("What do you like doing after school?", [])
    q, dropped = guards.check_followup({"question": "What is your caste and family income?"})
    assert q is None and "personal data" in dropped[0]["reason"]
    assert guards.check_followup({"question": ""})[0] is None


def test_personalise_endpoint(client, monkeypatch):
    monkeypatch.setattr(gemini_tasks, "personalise_careers", lambda *a, **k: ({
        "order": ["occ_fashion_designer", "occ_electrician"], "order_reason": "drawing",
        "items": [{"id": "occ_fashion_designer", "why": "You love drawing.", "quote": "drawing kolams"}]}, "stub", 5))
    r = client.post("/v1/careers/personalise", json={"shortlist": [{"id": i, "score": 0.5} for i in SHORT], "quotes": QUOTES, "lang": "en"})
    body = r.json()
    assert body["source"] == "gemini"
    assert body["order"] == ["occ_fashion_designer", "occ_electrician", "occ_nurse_anm"]
    assert body["why"]["occ_fashion_designer"]["quote"] == "drawing kolams"


def test_personalise_falls_back_to_formula_order(client, monkeypatch):
    def down(*a, **k):
        raise gemini.GeminiUnavailable("503")
    monkeypatch.setattr(gemini_tasks, "personalise_careers", down)
    body = client.post("/v1/careers/personalise", json={"shortlist": [{"id": i} for i in SHORT]}).json()
    assert body["source"] == "unavailable" and body["order"] == SHORT


def test_followup_endpoint(client, monkeypatch):
    monkeypatch.setattr(gemini_tasks, "followup", lambda *a, **k: ({"question": "Tell me your phone number?", "aim": "x"}, "stub", 5))
    body = client.post("/v1/talk/followup", json={"turns": [{"said": "nothing"}], "lang": "en"}).json()
    assert body["question"] is None and body["trace"]["dropped"]
    monkeypatch.setattr(gemini_tasks, "followup", lambda *a, **k: ({"question": "What do you do on Sundays?", "aim": "hobby"}, "stub", 5))
    assert client.post("/v1/talk/followup", json={"turns": [{"said": "nothing"}]}).json()["question"] == "What do you do on Sundays?"


def test_scheme_catalogue_fetch_and_admin_update(client, monkeypatch):
    first = client.get("/v1/schemes")
    assert first.status_code == 200
    cat = first.json()
    assert {s["id"] for s in cat["schemes"]} == set(kb.schemes())
    etag = first.headers["etag"]
    assert client.get("/v1/schemes", headers={"If-None-Match": etag}).status_code == 304

    new = copy.deepcopy(kb.schemes()["sch_nmms"]) | {"id": "sch_test_new", "name": {"en": "Test scheme"}}
    rule = copy.deepcopy(kb.rules()["sch_nmms"]) | {"id": "sch_test_new"}
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "secret")
    assert client.put("/v1/schemes/sch_test_new", json={"scheme": new, "rule": rule}).status_code == 401

    bad = copy.deepcopy(rule)
    bad["fixtures"][0]["expected"] = "not_eligible"
    r = client.put("/v1/schemes/sch_test_new", json={"scheme": new, "rule": bad}, headers={"X-Admin-Token": "secret"})
    assert r.status_code == 422 and "fixture 0" in str(r.json())

    assert client.put("/v1/schemes/sch_test_new", json={"scheme": new, "rule": rule}, headers={"X-Admin-Token": "secret"}).json()["ok"]
    after = client.get("/v1/schemes")
    assert after.headers["etag"] != etag and "sch_test_new" in {s["id"] for s in after.json()["schemes"]}
    elig = client.post("/v1/eligibility", json={"facts": rule["fixtures"][0]["facts"]}).json()
    assert next(x for x in elig if x["scheme_id"] == "sch_test_new")["status"] == "eligible"

    assert client.delete("/v1/schemes/sch_nmms", headers={"X-Admin-Token": "secret"}).json()["ok"]
    assert "sch_nmms" not in {s["id"] for s in client.get("/v1/schemes").json()["schemes"]}
