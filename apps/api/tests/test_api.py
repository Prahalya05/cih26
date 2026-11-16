"""API checks using FastAPI's test client. Gemini is switched off so results are predictable."""
import sys
from pathlib import Path

import pytest
from phones import PhoneClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from fastapi.testclient import TestClient
    from app.main import app
    return PhoneClient(app, pg)


MEENA = {"education": "class10", "riasec": {"A": 0.9, "E": 0.6, "R": 0.5},
         "skills": [{"id": "sk_stitching", "confidence": 0.9}, {"id": "sk_drawing", "confidence": 0.8}]}


def test_health(client):
    assert client.get("/health").json() == {"ok": True, "ai": "keywords"}


def test_kb(client):
    data = client.get("/v1/kb").json()
    assert len(data["version"]) == 12 and data["skills"] and data["rules"]


def test_match(client):
    out = client.post("/v1/match", json={"persona": MEENA}).json()
    assert len(out["careers"]) == 8
    assert len({c["sector"] for c in out["careers"]}) >= 4


def test_match_rejects_unknown_skill(client):
    r = client.post("/v1/match", json={"persona": {"skills": [{"id": "sk_flying"}]}})
    assert r.status_code == 422


def test_eligibility(client):
    facts = {"age": 16, "gender": "female", "state": "TN", "category": "sc", "current_class": 10,
             "passed_class": 9, "stage": "school", "school_6_to_12": "govt", "family_income_inr": 90000}
    out = {r["scheme_id"]: r for r in client.post("/v1/eligibility", json={"facts": facts}).json()}
    assert out["sch_pre_matric_sc"]["status"] == "eligible"
    assert out["sch_pudhumai_penn"]["eligible_if"] is not None
    assert out["sch_pre_matric_sc"]["rule_updated"]


def test_extract_falls_back_to_keywords(client):
    out = client.post("/v1/profile/extract",
                      data={"question": "What do you do at home?", "text": "I stitch blouses. I also draw kolam."}).json()
    assert out["source"] == "keywords"
    ids = {s["id"] for s in out["skills"]}
    assert {"sk_stitching", "sk_drawing"} <= ids
    assert all(s["evidence"] for s in out["skills"])
    # Keyword fallback: one experience holding every skill found.
    assert len(out["experiences"]) == 1 and set(out["experiences"][0]["skill_ids"]) == ids


def test_gemini_experiences_are_cleaned():
    from app import kb
    from app.adapters.gemini import clean_experiences
    raw = [
        {"what": "Stitches blouses for neighbours", "responsibilities": ["takes measurements", " "],
         "skill_ids": ["sk_stitching", "sk_made_up", "sk_stitching"], "evidence": "I stitch blouses"},
        {"what": "", "responsibilities": [], "skill_ids": ["sk_drawing"], "evidence": "kolam"},
        {"what": "Draws kolam", "responsibilities": [], "skill_ids": ["sk_drawing"], "evidence": ""},
        "not an object",
    ]
    out = clean_experiences(raw, kb.skills())
    assert out == [{"what": "Stitches blouses for neighbours", "responsibilities": ["takes measurements"],
                    "skill_ids": ["sk_stitching"], "evidence": "I stitch blouses"}]
    assert clean_experiences(None, kb.skills()) == []


def test_extract_needs_input(client):
    assert client.post("/v1/profile/extract", data={"question": "q"}).status_code == 422


def test_sync_and_cohort(client):
    student = {"id": "s1", "name": "Meena", "facilitator_code": "PSG01", "updated_at": 2}
    action = {"id": "a1", "student_id": "s1", "kind": "endorse", "payload": {"skill_id": "sk_stitching"}, "by": "teacher"}
    teacher = client.as_phone("phoneT")
    # A student phone may not endorse; a teacher's phone may.
    out = client.post("/v1/sync", json={"students": [student], "actions": [action]}).json()
    assert out["stored_students"] == 1 and out["added_actions"] == 0
    out = client.post("/v1/sync", json={"actions": [action]}, headers=teacher).json()
    assert out["added_actions"] == 1
    # older copy is ignored, same action is not duplicated
    out = client.post("/v1/sync", json={"students": [{**student, "updated_at": 1}], "actions": [action]},
                      headers=teacher).json()
    assert out["stored_students"] == 0 and out["added_actions"] == 0
    assert client.get("/v1/facilitator/PSG01/cohort").status_code == 403  # student phone
    cohort = client.get("/v1/facilitator/PSG01/cohort", headers=teacher).json()
    assert [s["id"] for s in cohort["students"]] == ["s1"]
    assert cohort["actions"][0]["payload"] == {"skill_id": "sk_stitching"}
