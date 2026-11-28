"""Opt-in profile publishing: allow-list, minor protection, revoke -> 404, rate limit -> 429, RLS."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers import publish  # noqa: E402

NOW = 1763000000000


def test_allow_list_and_extra_forbid_unit():
    # Phone cannot inject extra fields (e.g. caste, income, phone)
    with pytest.raises(ValidationError):
        publish.PublishIn(student_id="st1", visibility="public", caste="SC")  # type: ignore[call-arg]

    # Server snapshot strips school for minors and excludes PII/free text
    snap_minor = publish.build_snapshot(
        {"id": "st1", "district": "Coimbatore", "birth_year": 2012, "caste": "SC", "income": 50000, "phone": "9876543210"},
        "PSG School", [], "👧", ["R", "A", "invalid_tag"], is_minor=True, age_band="under_18",
    )
    d = snap_minor.model_dump()
    assert set(d.keys()) == {"handle", "avatar", "district", "age_band", "verified_skills", "interest_tags", "school", "contact_note"}
    assert d["school"] is None
    assert d["interest_tags"] == ["Hands-on", "Creative"]
    assert d["handle"].startswith("S-")


def test_publish_minor_blocked_revoke_404_rls_and_rate_limit(pg):
    from fastapi.testclient import TestClient
    from phones import PhoneClient
    from app.main import app
    from app import ratelimit
    ratelimit.reset()

    c = PhoneClient(app, pg)
    # Minor (birth_year 2012) with publish_profile consent
    c.post("/v2/sync", json={"device_id": "p1", "students": [
        {"id": "st_min", "name": "Meena", "birth_year": 2012, "district": "Coimbatore",
         "consent": {"id": "c_min", "scopes": ["assess", "publish_profile"], "method": "paper_form", "granted_at": NOW}},
        {"id": "st_adu", "name": "Kavya", "birth_year": 2000, "district": "Madurai",
         "consent": {"id": "c_adu", "scopes": ["assess", "publish_profile"], "method": "self_18plus", "granted_at": NOW}},
    ], "events": []})

    # Minor cannot go public (403); verified_partners is allowed
    assert c.post("/v2/profile/publish", json={"student_id": "st_min", "visibility": "public"}).status_code == 403
    r_vp = c.post("/v2/profile/publish", json={"student_id": "st_min", "visibility": "verified_partners"})
    assert r_vp.status_code == 200
    assert r_vp.json()["snapshot"]["school"] is None
    # Public endpoint refuses minor slug (404)
    pub_client = TestClient(app)
    assert pub_client.get(f"/v2/public/profile/{r_vp.json()['slug']}").status_code == 404

    # Adult can go public; headers include noindex and no-store
    r_pub = c.post("/v2/profile/publish", json={"student_id": "st_adu", "visibility": "public"})
    assert r_pub.status_code == 200
    slug = r_pub.json()["slug"]
    res = pub_client.get(f"/v2/public/profile/{slug}")
    assert res.status_code == 200
    assert "noindex" in res.headers["x-robots-tag"]
    assert res.headers["cache-control"] == "no-store"

    # RLS: another school cannot preview/unpublish st_adu
    other = PhoneClient(app, pg, default="otherPhone", schools={"otherPhone": "sch_other"})
    assert other.post("/v2/profile/publish/preview", json={"student_id": "st_adu", "visibility": "public"}).status_code == 404

    # Revoking consent removes published profile -> 404
    c.post("/v2/sync", json={"device_id": "p1", "students": [
        {"id": "st_adu", "consent": {"id": "c_adu", "scopes": ["assess"], "method": "self_18plus", "granted_at": NOW}},
    ], "events": []})
    assert pub_client.get(f"/v2/public/profile/{slug}").status_code == 404

    # Rate limit -> 429 after 20/min
    for _ in range(25):
        if pub_client.get(f"/v2/public/profile/{slug}").status_code == 429:
            break
    else:
        pytest.fail("Expected 429 rate limit")
