"""Phase 11: consent scopes and withdrawal, full erasure, under-18 safety."""
import pytest
from phones import PhoneClient
from fastapi.testclient import TestClient

NOW = 1763000000000


def uid(n: int) -> str:
    return f"01KA{n:022d}"


def student(scopes, revoked=None, birth_year=None, sid="st1"):
    return {"id": sid, "name": "Meena Kumari" if sid == "st1" else "Priya", "birth_year": birth_year,
            "consent": {"id": f"c_{sid}", "scopes": scopes, "method": "paper_form", "granted_at": NOW,
                        "guardian_name": "Lakshmi", "revoked_at": revoked}}


def order(n, sid="st1"):
    return {"id": uid(n), "student_id": sid, "device_id": "phoneA", "kind": "order", "skill_id": "sk_stitching",
            "payload": {"amount_inr": 100, "what": "Blouse"}, "created_at": NOW + n}


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app.main import app
    return PhoneClient(app, pg)


def test_withdrawn_consent_stops_sync_both_ways(client):
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [student(["assess"])], "events": [order(1)]})
    out = client.post("/v2/sync", json={"device_id": "phoneA", "students": [student(["assess"], revoked=NOW + 5)],
                                        "events": [order(2)]}).json()
    assert out["accepted"] == [] and out["rejected"][0]["errors"] == ["no consent to assess this student"]
    pulled = client.post("/v2/sync", json={"device_id": "phoneB", "student_ids": ["st1"], "cursor": 0}).json()
    assert pulled["events"] == []
    # Consent given again: sync resumes.
    again = client.post("/v2/sync", json={"device_id": "phoneA", "students": [student(["assess"])], "events": [order(2)]})
    assert again.json()["accepted"] == [uid(2)]


def test_guardian_name_is_kept_only_in_student_private(client):
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [student(["assess"])]})
    from app import db
    with db.connect() as con:
        assert con.execute("select guardian_name from student_private where student_id='st1'").fetchone()["guardian_name"] == "Lakshmi"
        cols = {r["column_name"] for r in con.execute(
            "select column_name from information_schema.columns where table_name = 'consent'")}
    assert "guardian_name" not in cols


def test_delete_needs_confirmation(client):
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [student(["assess"])]})
    assert client.request("DELETE", "/v2/student/st1", json={"confirmed_by": "someone"}).status_code == 400
    assert client.request("DELETE", "/v2/student/st1", json={}).status_code == 422


def test_delete_leaves_no_row_with_the_student_id(client):
    from app import db
    client.post("/v2/sync", json={"device_id": "phoneA", "students": [student(["assess", "photos"]),
                                                                     student(["assess"], sid="st2")],
                                  "events": [order(1), order(2, sid="st2")]})
    token = client.post(f"/v2/orders/{uid(1)}/link").json()["token"]
    client.post(f"/v2/confirm/{token}", json={"on_time": True, "quality": True, "rehire": True})
    client.post("/v1/sync", json={"students": [{"id": "st1", "name": "Meena", "facilitator_code": "PSG01",
                                                "cards": {}, "answers": {}, "factAnswers": {}, "updated_at": NOW}],
                                  "actions": [{"id": "a1", "student_id": "st1", "kind": "endorse",
                                               "payload": {"skill_id": "sk_stitching"}, "created_at": NOW}]})

    assert client.request("DELETE", "/v2/student/st1", json={"confirmed_by": "guardian"}).json() == {"deleted": True}
    assert client.request("DELETE", "/v2/student/st1", json={"confirmed_by": "guardian"}).json() == {"deleted": False}

    with db.connect() as con:
        cols = con.execute("select table_name, column_name from information_schema.columns where table_schema = 'public' "
                           "and data_type in ('text', 'jsonb') and table_name <> 'schema_migrations'").fetchall()
        left = []
        for c in cols:
            n = con.execute(f'select count(*) as n from "{c["table_name"]}" where "{c["column_name"]}"::text = %s', ("st1",)).fetchone()["n"]
            if n:
                left.append(f'{c["table_name"]}.{c["column_name"]}')
            docs = con.execute(f'select count(*) as n from "{c["table_name"]}" where "{c["column_name"]}"::text like %s',
                               ("%Meena%",)).fetchone()["n"]
            if docs:
                left.append(f'{c["table_name"]}.{c["column_name"]} (name)')
        assert left == []
        assert con.execute("select count(*) as n from evidence_event where student_id = 'st2'").fetchone()["n"] == 1
        assert con.execute("select sum(n) as n from deletion_count").fetchone()["n"] == 1


def test_hazardous_checklist_items_are_never_scored_for_under_18s(client, monkeypatch):
    from app.adapters import gemini_vision
    seen = {}

    def fake(rubric, image, mime):
        seen["criteria"] = [c["id"] for c in rubric["criteria"]]
        return gemini_vision.clean(rubric, {"criteria": [{"id": c["id"], "score": 2, "reason": "ok"} for c in rubric["criteria"]]})

    monkeypatch.setattr(gemini_vision, "score", fake)
    from app import kb
    hazardous = {s for s, v in kb.graph()["subskills"].items() if v["hazardous_under_18"]}
    elec = kb.rubrics()["rb_electrical"]
    risky = {c["id"] for c in elec["criteria"] if c.get("subskill") in hazardous}

    def post():
        return client.post("/v2/work-sample/score", data={"student_id": "st1", "rubric_id": "rb_electrical"},
                           files={"image": ("w.jpg", b"\xff\xd8\xff", "image/jpeg")})

    client.post("/v2/sync", json={"device_id": "d", "students": [student(["assess", "photos"], birth_year=2011)]})
    r = post().json()
    assert seen["criteria"] and not set(seen["criteria"]) & risky and not set(r["scores"]) & risky

    client.post("/v2/sync", json={"device_id": "d", "students": [student(["assess", "photos"], birth_year=1990)]})
    post()
    assert risky <= set(seen["criteria"])


def test_safety_rule_matches_engine():
    from datetime import datetime
    from app.services.safety import is_minor
    now = datetime(2026, 11, 14)
    assert [is_minor(y, now) for y in (None, 2010, 2008, 2007)] == [True, True, True, False]


def test_privacy_check_passes_and_catches_a_name_column(tmp_path, monkeypatch):
    import check_privacy
    assert check_privacy.personal_columns_outside_private() == []
    assert check_privacy.tracking_dependencies() == []
    for f in check_privacy.MIGRATIONS.glob("*.sql"):
        (tmp_path / f.name).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "9999_bad.sql").write_text("alter table outcome add column mother_name text;\n", encoding="utf-8")
    monkeypatch.setattr(check_privacy, "MIGRATIONS", tmp_path)
    assert check_privacy.personal_columns_outside_private() == ["outcome.mother_name"]
