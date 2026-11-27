"""Location-aware teacher search: opt-in only, cross-school, centroid sorting, no GPS, pagination, and 429 rate limit."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import kb  # noqa: E402
from app.routers import courses  # noqa: E402


def test_districts_kb_and_haversine_unit():
    dists = kb.districts()
    assert "tn_coimbatore" in dists and "tn_tiruppur" in dists and "tn_chennai" in dists
    cbe = dists["tn_coimbatore"]
    tpr = dists["tn_tiruppur"]
    chn = dists["tn_chennai"]
    assert courses._haversine_km(cbe["lat"], cbe["lng"], tpr["lat"], tpr["lng"]) < courses._haversine_km(cbe["lat"], cbe["lng"], chn["lat"], chn["lng"])
    assert courses._resolve_district("Coimbatore")["code"] == "tn_coimbatore"


def _seed_teacher(pg, school_id: str, school_name: str, phone: str, name: str,
                  district_code: str, listed: bool, subjects: list[str], languages: list[str], published_courses: int = 0):
    from app.routers.accounts import login_hash
    from app import auth
    import secrets
    with pg.cursor() as cur:
        cur.execute("insert into school(id, name, district) values (%s, %s, %s) on conflict (id) do nothing",
                    (school_id, school_name, district_code))
        acc_id = f"acc_{secrets.token_hex(4)}"
        cur.execute("insert into account(id, role, name, login_kind, login_hash, login_mask, school_id) "
                    "values (%s, 'teacher', %s, 'phone', %s, '98••••10', %s)",
                    (acc_id, name, login_hash(phone), school_id))
        cur.execute("insert into teacher_profile(account_id, subjects, languages, district, district_code, pincode, listed) "
                    "values (%s, %s, %s, %s, %s, '641001', %s)",
                    (acc_id, subjects, languages, kb.districts()[district_code]["name"]["en"], district_code, listed))
        for i in range(published_courses):
            cur.execute("insert into course(id, teacher_id, school_id, title, language, skill_id, plan, price_inr, published) "
                        "values (%s, %s, %s, %s, 'ta', 'sk_stitch', 'free', 0, true)",
                        (f"crs_{acc_id}_{i}", acc_id, school_id, f"Course {i}"))
        dev_id = f"dev_{acc_id}"
        tok = secrets.token_urlsafe(12)
        cur.execute("insert into device(id, school_id, role, token_hash, account_id) values (%s, %s, 'teacher', %s, %s)",
                    (dev_id, school_id, auth.hash_token(tok), acc_id))
    pg.commit()
    return tok


def test_teacher_search_opt_in_cross_school_distance_pagination_and_privacy(pg):
    from app.main import app
    from app import ratelimit
    ratelimit.reset()

    tok = _seed_teacher(pg, "sch_a", "School A", "+919000000001", "Anitha", "tn_coimbatore", True, ["Tailoring"], ["ta", "en"], 2)
    _seed_teacher(pg, "sch_b", "School B", "+919000000002", "Bala", "tn_tiruppur", True, ["Tailoring"], ["ta"], 1)
    _seed_teacher(pg, "sch_c", "School C", "+919000000003", "Chitra", "tn_chennai", True, ["Electronics"], ["ta"], 0)
    _seed_teacher(pg, "sch_d", "School D", "+919000000004", "Hidden", "tn_coimbatore", False, ["Tailoring"], ["ta"], 3)

    c = TestClient(app)
    hdr = {"Authorization": f"Bearer {tok}"}

    # Unlisted teacher never appears; listed teachers from different schools appear sorted by distance from Coimbatore
    r = c.get("/v2/teachers/search?district=tn_coimbatore", headers=hdr)
    assert r.status_code == 200
    data = r.json()
    names = [t["name"] for t in data["teachers"]]
    assert "Hidden" not in names
    assert names == ["Anitha", "Bala", "Chitra"]
    assert "pincode" not in data["teachers"][0]

    # Subject filter + pagination
    r2 = c.get("/v2/teachers/search?subject=tailor&limit=1&offset=1", headers=hdr)
    assert r2.status_code == 200 and r2.json()["total"] == 2 and len(r2.json()["teachers"]) == 1

    # Coordinates rejected
    assert c.get("/v2/teachers/search?lat=11.0&lng=77.0", headers=hdr).status_code == 400

    # Rate limit triggers 429 after 30/min
    for _ in range(30):
        res = c.get("/v2/teachers/search", headers=hdr)
        if res.status_code == 429:
            break
    else:
        pytest.fail("Expected 429 rate limit")
