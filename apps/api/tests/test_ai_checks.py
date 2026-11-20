"""AI suggests, rules decide: interests from her own words and wider career ideas.

Gemini is stubbed: each test makes the "AI" return something a rule must reject, and checks it was dropped
and reported in the response's trace (which the app shows in the decision X-ray).
"""
from __future__ import annotations

import pytest

from app.adapters import gemini, gemini_tasks
from app.services import guards
from phones import PhoneClient


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("DEMO_CACHE", raising=False)
    from app.main import app
    return PhoneClient(app, pg)


def test_interest_guard_keeps_only_quoted_riasec_letters():
    said = "I love fixing my father's motor and drawing kolams"
    kept, dropped = guards.check_interests([
        {"letter": "R", "tag": "repair", "evidence": "fixing my father's motor", "strength": 0.9},
        {"letter": "a", "tag": "art", "evidence": "drawing kolams", "strength": "bad"},
        {"letter": "S", "tag": "helping", "evidence": "teaching small children"},  # never said
        {"letter": "Z", "tag": "?", "evidence": "motor"},
        "junk",
    ], said)
    assert [k["letter"] for k in kept] == ["R", "A"]
    assert kept[1]["strength"] == 0.6
    assert {d["reason"] for d in dropped} == {"quote not found in what she said", "not a RIASEC letter"}


def test_career_guard_drops_invented_and_shown_ids():
    kept, dropped = guards.check_careers([
        {"id": "occ_solar_pv_technician", "why": "you like fixing things"},
        {"id": "occ_astronaut_made_up", "why": "?"},
        {"id": "occ_electrician", "why": "already listed"},
    ], exclude={"occ_electrician"})
    assert [k["id"] for k in kept] == ["occ_solar_pv_technician"]
    assert {d["value"] for d in dropped} == {"occ_astronaut_made_up", "occ_electrician"}


def test_interest_keywords_three_languages():
    assert {x["letter"] for x in guards.interests_from_keywords("I want to open a shop")} == {"E"}
    assert "A" in {x["letter"] for x in guards.interests_from_keywords("எனக்கு ஓவியம் பிடிக்கும்")}
    assert "S" in {x["letter"] for x in guards.interests_from_keywords("मुझे बच्चों को पढ़ाना पसंद है")}


def test_interests_route_falls_back_without_ai(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    out = client.post("/v1/profile/interests", data={"text": "I like repairing bikes and selling in our shop"}).json()
    assert out["source"] == "keywords"
    assert {"R", "E"} <= {x["letter"] for x in out["interests"]}
    assert out["trace"]["fallback"]
    assert client.post("/v1/profile/interests", data={}).status_code == 422


def test_interests_route_reports_what_the_rule_dropped(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setattr(gemini_tasks, "interests", lambda **kw: ({
        "transcript": "I like stitching clothes",
        "interests": [{"letter": "A", "tag": "design", "evidence": "stitching clothes", "strength": 0.8},
                      {"letter": "I", "tag": "science", "evidence": "doing experiments", "strength": 0.9}],
    }, "stub-model", 12))
    out = client.post("/v1/profile/interests", data={"text": "I like stitching clothes"}).json()
    assert out["source"] == "gemini"
    assert [x["letter"] for x in out["interests"]] == ["A"]
    assert out["trace"]["model"] == "stub-model"
    assert out["trace"]["dropped"][0]["reason"] == "quote not found in what she said"


def test_careers_suggest_drops_ids_outside_catalogue(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setattr(gemini_tasks, "suggest_careers", lambda profile, lang: ({
        "ideas": [{"id": "occ_beautician", "why": "you like colour"}, {"id": "occ_youtube_star", "why": "fame"}],
    }, "stub-model", 20))
    out = client.post("/v1/careers/suggest", json={"riasec": {"A": 1}, "skills": [], "exclude": []}).json()
    assert [x["id"] for x in out["ideas"]] == ["occ_beautician"]
    assert out["trace"]["dropped"] == [{"value": "occ_youtube_star", "reason": "not in the career catalogue"}]


def test_careers_suggest_without_ai(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    out = client.post("/v1/careers/suggest", json={}).json()
    assert out["source"] == "unavailable" and out["ideas"] == []


def test_ai_routes_need_a_registered_phone(client):
    assert client.post("/v1/careers/suggest", json={}, headers={"Authorization": ""}).status_code == 401


def test_extract_trace_names_fallback(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    out = client.post("/v1/profile/extract", data={"question": "q", "text": "I stitch"}).json()
    assert out["trace"]["model"] == "keywords" and out["trace"]["fallback"]
    assert gemini.enabled() is False


def test_rate_limit_returns_429(client, monkeypatch):
    from app import ratelimit
    ratelimit.reset()
    monkeypatch.setenv("RATE_LIMIT_SCALE", "0.1")  # 30/min -> 3/min for this test
    codes = [client.post("/v1/careers/suggest", json={}).status_code for _ in range(4)]
    assert codes[:3] == [200, 200, 200] and codes[3] == 429
    ratelimit.reset()
