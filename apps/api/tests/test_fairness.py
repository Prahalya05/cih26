"""Fairness tests (Step 12.1), run in CI.

1. Gender swap: flipping a student's gender changes no skill level and no career ranking.
2. Under-claiming: a student who under-reports but performs the same reaches the same level.
3. Ranking spread: girls' top 8 careers cover at least as many sectors as boys' for the same evidence.

Synthetic students come from scripts/simulate.py (the same bench used for Step 4.7).
"""
from __future__ import annotations

import random
import re
from pathlib import Path

import pytest
from phones import PhoneClient
from fastapi.testclient import TestClient

import simulate
from scenarios import ulid_at
from app.services import fitreach, tracing

N = 200
API = Path(__file__).resolve().parents[1] / "app"


@pytest.fixture(scope="module")
def bench():
    rng = random.Random(7)
    banks = {s: simulate.make_bank(rng, s) for s in simulate.SUBSKILLS}
    items = {it["id"]: it for b in banks.values() for it in b}
    return banks, items


def student(seed: int, banks: dict, bias: float = 1.0) -> list[dict]:
    events, _, _ = simulate.simulate_student(random.Random(seed), f"s{seed}", banks, bias)
    return events


def fold(events: list[dict], items: dict) -> dict:
    return tracing.fold_events(events, {"now": max(e["created_at"] for e in events), "items": items})


def ranking(profile: dict, facts: dict) -> list[str]:
    persona = fitreach.persona_from_profile(profile, education=facts.get("education"))
    persona["gender"] = facts["gender"]  # present, as it is on the student record; must not matter
    return [c["occupation_id"] for c in fitreach.recommend_v2(persona)["careers"]]


def test_scoring_code_never_reads_gender():
    """Levels and careers are computed without the student's gender (it is kept only for these checks)."""
    for name in ("services/tracing.py", "services/irt.py", "services/fitreach.py", "services/matcher.py",
                 "services/raters.py", "services/safety.py"):
        text = (API / name).read_text(encoding="utf-8")
        assert not re.search(r"gender|\bsex\b|female|male", text, re.I), name


def test_gender_swap_changes_no_level_and_no_ranking(bench):
    banks, items = bench
    for seed in range(N):
        profile = fold(student(seed, banks), items)
        facts = {"education": "class10", "gender": "female"}
        girl = ranking(profile, facts)
        boy = ranking(profile, {**facts, "gender": "male"})
        assert girl == boy, seed


def _copy_for(events: list[dict], sid: str, base: int) -> list[dict]:
    """Same evidence for another student id, with fresh event ids."""
    new_ids = {e["id"]: ulid_at(e["created_at"], base + i) for i, e in enumerate(events)}
    return [{**e, "id": new_ids[e["id"]], "student_id": sid,
             **({"refers_to": new_ids[e["refers_to"]]} if e.get("refers_to") else {})} for e in events]


def test_gender_swap_through_sync(pg, monkeypatch, bench):
    """Through the real server path: the stored levels for a girl and a boy with the same evidence are equal."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app import db
    from app.main import app
    client = PhoneClient(app, pg, teachers=("sim",))
    banks, _ = bench
    consent = {"scopes": ["assess"], "method": "paper_form", "granted_at": 1763000000000}
    for k, seed in enumerate(range(20)):
        evs = student(seed, banks)
        for gender in ("female", "male"):
            sid = f"{gender}_{seed}"
            body = {"device_id": "sim", "raters": [{"id": "buyer", "role": "teacher"}],
                    "students": [{"id": sid, "gender": gender, "consent": {"id": f"c_{sid}", **consent}}],
                    "events": _copy_for(evs, sid, (k * 2 + (gender == "male")) * 1000)}
            out = client.post("/v2/sync", json=body).json()
            assert out["rejected"] == [], out["rejected"][:2]
    # Synced items are not in the KB bank, so both get the same "unknown item" treatment: still must match.
    with db.connect() as con:
        rows = con.execute("select student_id, subskill_id, p_level from skill_state").fetchall()
    by = {(r["student_id"], r["subskill_id"]): r["p_level"] for r in rows}
    for seed in range(20):
        girl = {s: p for (sid, s), p in by.items() if sid == f"female_{seed}"}
        boy = {s: p for (sid, s), p in by.items() if sid == f"male_{seed}"}
        # Levels are rebuilt at sync time ("now"), so the two copies differ by a few milliseconds of ageing.
        assert girl and girl.keys() == boy.keys(), seed
        for sub in girl:
            assert girl[sub] == pytest.approx(boy[sub], abs=1e-6), (seed, sub)


def test_under_claiming_does_not_lower_the_level(bench):
    """Same performance, different self-reporting: under-reporters (who claim half as often) end at the same
    level as accurate reporters in at least 97% of cases, and never more than one level apart."""
    banks, items = bench
    same = total = 0
    for seed in range(N):
        # The simulator draws the same random numbers either way, so tests, samples and orders are identical.
        shy = fold(student(1000 + seed, banks, bias=0.5), items)["units"]
        accurate = fold(student(1000 + seed, banks, bias=1.0), items)["units"]
        for sub in simulate.SUBSKILLS:
            a, b = shy[sub]["level"], accurate[sub]["level"]
            assert abs(a - b) <= 1, (seed, sub, a, b)
            same += a == b
            total += 1
    assert same / total >= 0.97, same / total


def test_girls_top_careers_cover_as_many_sectors(bench):
    banks, items = bench
    for seed in range(N):
        profile = fold(student(2000 + seed, banks), items)
        persona = fitreach.persona_from_profile(profile)
        girl = fitreach.recommend_v2({**persona, "gender": "female"})["careers"]
        boy = fitreach.recommend_v2({**persona, "gender": "male"})["careers"]
        assert len({c["sector"] for c in girl}) >= len({c["sector"] for c in boy}), seed
        assert len({c["sector"] for c in girl}) >= 4, seed
