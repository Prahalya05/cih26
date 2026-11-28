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


def test_publish_minor_blocked_revoke_404_rls_and_rate_limit(pg, monkeypatch):
    from fastapi.testclient import TestClient
    from phones import PhoneClient
    from app.main import app
    from app import ratelimit
    monkeypatch.setenv("RATE_LIMIT_SCALE", "1")
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


def test_school_and_verified_partners_readers_and_refresh_snapshot(pg):
    from fastapi.testclient import TestClient
    from phones import PhoneClient
    from app import db
    from app.main import app
    from app.routers.accounts import login_hash

    c = PhoneClient(app, pg)
    c.post("/v2/sync", json={"device_id": "p1", "students": [
        {"id": "st_sch", "name": "Anu", "birth_year": 2012, "district": "Salem",
         "consent": {"id": "c_sch", "scopes": ["assess", "publish_profile"], "method": "paper_form", "granted_at": NOW}},
        {"id": "st_vp", "name": "Bala", "birth_year": 2012, "district": "Madurai",
         "consent": {"id": "c_vp", "scopes": ["assess", "publish_profile"], "method": "paper_form", "granted_at": NOW}},
        {"id": "st_fake_otp", "name": "Chitra", "birth_year": 2012, "district": "Erode",
         "consent": {"id": "c_fake", "scopes": ["assess", "publish_profile"], "method": "otp", "granted_at": NOW}},
    ], "events": []})

    assert c.post("/v2/profile/publish", json={"student_id": "st_sch", "visibility": "school"}).status_code == 200
    r_vp = c.post("/v2/profile/publish", json={"student_id": "st_vp", "visibility": "verified_partners"})
    assert r_vp.status_code == 200
    vp_slug = r_vp.json()["slug"]
    # Minor with consent.method='otp' but NO verified guardian_otp cannot publish verified_partners
    assert c.post("/v2/profile/publish", json={"student_id": "st_fake_otp", "visibility": "verified_partners"}).status_code == 403

    # School reader: same-school teacher sees school & verified_partners; student and other school do not
    t_hdr = c.as_phone("phoneT")
    assert c.get("/v2/school/profiles").status_code == 403
    sch_list = c.get("/v2/school/profiles", headers=t_hdr)
    assert sch_list.status_code == 200 and len(sch_list.json()["profiles"]) == 2
    assert c.get("/v2/school/profiles/st_sch", headers=t_hdr).status_code == 200
    other = PhoneClient(app, pg, teachers=("otherT",), default="otherT", schools={"otherT": "sch_other"})
    assert other.get("/v2/school/profiles/st_sch").status_code == 404

    # Verified partners reader: employer/donor only, sees verified_partners snapshot
    with db.connect() as con:
        con.execute("insert into account(id, role, name, login_kind, login_hash, login_masked, privacy_ok_at) values "
                    "('acc_emp', 'employer', 'Emp', 'phone', %s, '98••••01', now())", (login_hash("9800000001"),))
        con.execute("insert into device(id, role, account_id, token_hash) values "
                    "('dev_emp', 'employer', 'acc_emp', 'tok_emp_hash')")
    from app import auth
    emp_tok = auth.new_token()
    with db.connect() as con:
        con.execute("update device set token_hash = %s where id = 'dev_emp'", (auth.hash_token(emp_tok),))
    emp_hdr = {"Authorization": f"Bearer {emp_tok}"}
    assert c.get("/v2/partners/profiles").status_code == 403
    plist = TestClient(app).get("/v2/partners/profiles", headers=emp_hdr)
    assert plist.status_code == 200 and len(plist.json()["profiles"]) == 1
    assert TestClient(app).get(f"/v2/partners/profiles/{vp_slug}", headers=emp_hdr).status_code == 200

    # Syncing new task evidence triggers refresh_state -> rebuilds published snapshot automatically
    c.post("/v2/sync", json={"device_id": "p1", "events": [
        {"id": "01KA0000000000000000000091", "student_id": "st_vp", "device_id": "p1", "kind": "task",
         "skill_id": "sk_stitching", "subskill_id": "ss_stitch_machine", "payload": {"score": 0.95}, "created_at": NOW + 5},
    ]})
    rebuilt = TestClient(app).get(f"/v2/partners/profiles/{vp_slug}", headers=emp_hdr).json()
    assert any(s["id"] == "ss_stitch_machine" for s in rebuilt["verified_skills"])


def test_guardian_otp_teacher_only_differs_from_student_and_survives_sync(pg):
    from phones import PhoneClient
    from app import db
    from app.main import app
    from app.routers.accounts import login_hash

    c = PhoneClient(app, pg)
    c.post("/v2/sync", json={"device_id": "p1", "students": [
        {"id": "st_m", "name": "Divya", "birth_year": 2012, "district": "Coimbatore",
         "consent": {"id": "c_m", "scopes": ["assess", "publish_profile"], "method": "otp", "granted_at": NOW}},
    ], "events": []})
    with db.connect() as con:
        con.execute("insert into account(id, role, name, login_kind, login_hash, login_masked, privacy_ok_at, student_id, school_id) values "
                    "('acc_stu', 'student', 'Divya', 'phone', %s, '98••••10', now(), 'st_m', 'sch_test')", (login_hash("9876543210"),))

    # Student phone cannot request guardian OTP for under-18
    assert c.post("/v2/consent/guardian-otp", json={"student_id": "st_m", "phone": "9811111111"}).status_code == 403

    # Teacher phone cannot use student's own phone as guardian phone
    t_hdr = c.as_phone("phoneT")
    assert c.post("/v2/consent/guardian-otp", json={"student_id": "st_m", "phone": "9876543210"}, headers=t_hdr).status_code == 400

    # Teacher phone with distinct guardian phone succeeds & verifies
    otp = c.post("/v2/consent/guardian-otp", json={"student_id": "st_m", "phone": "9811111111"}, headers=t_hdr).json()
    assert c.post("/v2/consent/guardian-otp/verify", json={"student_id": "st_m", "code": otp["demo_code"]}, headers=t_hdr).status_code == 200

    # Subsequent consent upsert on sync does not erase guardian_otp.verified_at
    c.post("/v2/sync", json={"device_id": "p1", "students": [
        {"id": "st_m", "consent": {"id": "c_m", "scopes": ["assess", "publish_profile"], "method": "otp", "granted_at": NOW + 1}},
    ], "events": []})
    assert c.post("/v2/profile/publish", json={"student_id": "st_m", "visibility": "verified_partners"}).status_code == 200
