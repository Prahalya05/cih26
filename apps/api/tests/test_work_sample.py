"""Work-sample scoring: consent check, AI unavailable, cleaning of model output."""
import pytest
from fastapi.testclient import TestClient

from app import kb
from app.adapters import gemini_vision

NOW = 1763000000000


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app.main import app
    return TestClient(app)


def student(scopes):
    return {"id": "st1", "consent": {"id": "c1", "scopes": scopes, "method": "paper_form", "granted_at": NOW}}


def post(client):
    return client.post("/v2/work-sample/score", data={"student_id": "st1", "rubric_id": "rb_stitching"},
                       files={"image": ("blouse.jpg", b"\xff\xd8fakejpeg", "image/jpeg")})


def test_needs_photo_consent(client):
    client.post("/v2/sync", json={"device_id": "d", "students": [student(["assess"])]})
    assert post(client).status_code == 403


def test_ai_unavailable_means_teacher_scores(client):
    client.post("/v2/sync", json={"device_id": "d", "students": [student(["assess", "photos"])]})
    r = post(client)
    assert r.status_code == 503


def test_scores_come_back_cleaned(client, monkeypatch):
    client.post("/v2/sync", json={"device_id": "d", "students": [student(["assess", "photos"])]})
    monkeypatch.setattr(gemini_vision, "score", lambda rubric, image, mime: gemini_vision.clean(rubric, {"criteria": [
        {"id": "seams", "score": 2, "reason": "straight", "cannot_see": False},
        {"id": "fit", "score": 1, "reason": "?", "cannot_see": True},
        {"id": "edges", "score": 7, "reason": "bad score", "cannot_see": False},
        {"id": "made_up", "score": 2, "reason": "x", "cannot_see": False},
    ]}))
    r = post(client).json()
    assert r["scores"] == {"seams": 2}
    assert set(r["cannot_see"]) == {"even", "edges", "fit", "shape"}


def test_unknown_rubric(client):
    r = client.post("/v2/work-sample/score", data={"student_id": "st1", "rubric_id": "rb_nope"},
                    files={"image": ("a.jpg", b"x", "image/jpeg")})
    assert r.status_code == 404


def test_rubrics_load():
    assert set(kb.rubrics()) == {"rb_stitching", "rb_electrical"}
