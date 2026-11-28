"""Proof Pays API: credentials (consent, contents, signature), video scoring rules, payouts without a chain."""
import pytest
from phones import PhoneClient

from app import chain
from app.adapters import gemini_video
from app.zk import credential, eddsa

NOW = 1763000000000
ISSUER_KEY = "11" * 32
HOLDER = "123456789"


@pytest.fixture()
def client(pg, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("ZK_ISSUER_KEY", ISSUER_KEY)
    monkeypatch.setattr(chain, "deployment", lambda: {})  # no chain in tests
    monkeypatch.delenv("CHAIN_RPC_URL", raising=False)
    from app.main import app
    return PhoneClient(app, pg)


def sync_student(client, scopes, events=(), birth_year=2008):
    r = client.post("/v2/sync", json={"device_id": "phoneA", "students": [
        {"id": "stu1", "birth_year": birth_year,
         "consent": {"id": "c1", "scopes": scopes, "method": "paper_form", "granted_at": NOW}}], "events": list(events)})
    assert r.status_code == 200, r.text


def order(n):
    return {"id": f"01KA00000000000000000000{n:02d}", "student_id": "stu1", "device_id": "phoneA", "kind": "order",
            "skill_id": "sk_stitching", "payload": {"amount_inr": 350, "what": "Blouse"}, "created_at": NOW + n}


def cred(client, **facts):
    return client.post("/v2/credential", json={"student_id": "stu1", "holder": HOLDER, "facts": facts})


def test_credential_needs_share_consent(client):
    sync_student(client, ["assess"])
    assert cred(client).status_code == 403


def test_credential_is_signed_and_counts_only_confirmed_orders(client):
    sync_student(client, ["assess", "share_portfolio"], [order(1), order(2)])
    token = client.post(f"/v2/orders/{order(1)['id']}/link").json()["token"]
    client.post(f"/v2/confirm/{token}", json={"on_time": True, "quality": True, "rehire": True})
    r = cred(client, family_income_inr=120000, gender="female", category="bc")
    assert r.status_code == 200, r.text
    out = r.json()
    c = out["credential"]
    assert out["orders"] == 1 and out["earned_inr"] == 350  # the unconfirmed order does not count
    f = c["fields"]
    assert f["holder"] == HOLDER and f["income_band"] == "1" and f["gender"] == "1" and f["category"] == "4"
    assert f["birth_year"] == "2008"
    assert credential.verify(c)
    pub = eddsa.public_key(eddsa.secret_scalar(ISSUER_KEY))
    assert c["issuer"] == [str(pub[0]), str(pub[1])]
    # changing any field breaks the signature
    assert not credential.verify({**c, "fields": {**f, "orders": "5"}})


def test_credential_refuses_bad_holder(client):
    sync_student(client, ["assess", "share_portfolio"])
    assert client.post("/v2/credential", json={"student_id": "stu1", "holder": "9" * 78}).status_code == 422
    assert client.post("/v2/credential", json={"student_id": "stu1", "holder": "0x12"}).status_code == 422


def test_no_issuer_key_means_503(client, monkeypatch):
    monkeypatch.delenv("ZK_ISSUER_KEY")
    sync_student(client, ["assess", "share_portfolio"])
    assert cred(client).status_code == 503


def test_payouts_off_without_a_chain(client):
    cfg = client.get("/v2/pay/config").json()
    assert cfg["enabled"] is False and cfg["milestones"] == [] and len(cfg["subskill_order"]) <= 32
    body = {"milestone_id": 1, "payout": "0x" + "ab" * 20, "today": 20000,
            "proof": {"pi_a": ["1", "2"], "pi_b": [["1", "2"], ["3", "4"]], "pi_c": ["1", "2"]},
            "public_signals": ["0"] * 11}
    assert client.post("/v2/pay/claim", json=body).status_code == 503


def test_unreachable_chain_is_off_and_hides_the_rpc_address(client, monkeypatch):
    # The committed local Anvil deployment on a server with no Anvil: no 127.0.0.1 address may reach browsers.
    monkeypatch.setattr(chain, "deployment", lambda: {"rpc_url": "http://127.0.0.1:1", "proofpays": "0x" + "ab" * 20,
                                                      "token": "0x" + "cd" * 20, "chain_id": 31337})
    cfg = client.get("/v2/pay/config").json()
    assert cfg["enabled"] is False and cfg["error"] and cfg["milestones"] == []
    assert "rpc_url" not in cfg and "token" not in cfg


def video(client, rubric="rb_stitching", mime="video/webm", data=b"\x1a\x45\xdf\xa3fake"):
    return client.post("/v2/work-sample/video", data={"student_id": "stu1", "rubric_id": rubric, "process": '{"steadiness": 0.8}'},
                       files={"video": ("work.webm", data, mime)})


def test_video_needs_photo_consent_and_a_video(client, monkeypatch):
    sync_student(client, ["assess"])
    assert video(client).status_code == 403
    sync_student(client, ["assess", "photos"])
    assert video(client, mime="image/jpeg").status_code == 415
    assert video(client, rubric="rb_nope").status_code == 404
    monkeypatch.setattr(gemini_video, "MAX_VIDEO_BYTES", 4)
    assert video(client).status_code == 413


def test_video_ai_unavailable_means_teacher_scores(client):
    sync_student(client, ["assess", "photos"])
    assert video(client).status_code == 503


def test_video_scores_have_times_and_safety(client, monkeypatch):
    sync_student(client, ["assess", "photos"])
    seen = {}

    def fake(rubric, data, mime, process, moments=None):
        seen["process"] = process
        return gemini_video.clean_video(rubric, {"criteria": [
            {"id": "seams", "score": 2, "time": "0:07", "reason": "straight", "cannot_see": False},
            {"id": "fit", "score": 1, "time": "later", "reason": "ok", "cannot_see": False},
            {"id": "made_up", "score": 2, "time": "0:01", "reason": "x", "cannot_see": False},
        ], "safety": [{"time": "0:12", "note": "fingers close to the needle"}, {"time": "soon", "note": "bad time"}]})

    monkeypatch.setattr(gemini_video, "score", fake)
    r = video(client).json()
    assert r["scores"] == {"seams": 2, "fit": 1}
    assert r["times"] == {"seams": "0:07"}  # an invalid time is dropped, the score kept
    assert r["safety"] == [{"time": "0:12", "note": "fingers close to the needle"}]
    assert r["media"] == "video" and seen["process"] == {"steadiness": 0.8}


def test_video_trust_score_is_worked_out_on_the_server(client, monkeypatch):
    """The trust score comes from the warning counts by a fixed rule; the AI only adds 'ai_noticed' warnings."""
    sync_student(client, ["assess", "photos"])
    seen = {}

    def fake(rubric, data, mime, process, moments=None):
        seen["moments"] = moments
        return gemini_video.clean_video(rubric, {"criteria": [
            {"id": "seams", "score": 2, "time": "0:07", "reason": "straight", "cannot_see": False}], "safety": [],
            "suspicious": [{"time": "0:20", "note": "a phone screen shows other hands"}, {"time": "bad", "note": "x"}]})

    monkeypatch.setattr(gemini_video, "score", fake)
    r = client.post("/v2/work-sample/video", files={"video": ("work.webm", b"webm", "video/webm")}, data={
        "student_id": "stu1", "rubric_id": "rb_stitching",
        "integrity": '["screen"]', "integrity_counts": '{"screen": 1, "no_hands": 2, "ai_noticed": 9}',
        "moments": '[{"kind": "screen", "at": 20}]'}).json()
    assert seen["moments"] == [{"kind": "screen", "at": 20}]
    assert r["suspicious"] == [{"time": "0:20", "note": "a phone screen shows other hands"}]
    # 100 - 25 (screen) - 25 (the AI's one valid note; the phone's own ai_noticed count is ignored) - 10 (no hands)
    assert r["trust"]["score"] == 40 and r["trust"]["band"] == "low"
    assert r["scores"] == {"seams": 2}  # the skill score is not touched by the warnings
    assert r["autoconfirm"]["decision"] == "teacher"
    assert any("trust score 40" in w for w in r["autoconfirm"]["why"])


def test_long_task_sends_its_clips_and_counts_small_warnings_per_10_minutes(client, monkeypatch):
    """A long task: one-picture-a-second video plus full-speed clips; small warnings count per 10 minutes."""
    sync_student(client, ["assess", "photos"])
    seen = {}

    def fake(rubric, data, mime, process, moments=None, clips=None):
        seen["clips"] = clips
        return gemini_video.clean_video(rubric, {"criteria": [
            {"id": "seams", "score": 2, "time": "41:07", "reason": "straight", "cannot_see": False}], "safety": [], "suspicious": []})

    monkeypatch.setattr(gemini_video, "score", fake)
    files = [("video", ("long.webm", b"webm", "video/webm")),
             ("clips", ("c1.webm", b"c1", "video/webm")), ("clips", ("c2.webm", b"c2", "video/webm"))]
    r = client.post("/v2/work-sample/video", files=files, data={
        "student_id": "stu1", "rubric_id": "rb_stitching", "mode": "long", "process": '{"seconds": 3600}',
        "clip_info": '[{"at": 750, "why": "active"}, {"at": 3590, "why": "final"}]',
        "integrity_counts": '{"no_hands": 6}'}).json()
    assert [(b, info) for b, _, info in seen["clips"]] == [(b"c1", {"at": 750, "why": "active"}), (b"c2", {"at": 3590, "why": "final"})]
    assert r["trust"]["score"] == 95  # 6 times in an hour = 1 per 10 minutes
    assert r["times"]["seams"] == "41:07"  # times past an hour's first minutes are kept


def test_long_task_limits(client):
    sync_student(client, ["assess", "photos"])
    many = [("clips", (f"c{i}.webm", b"c", "video/webm")) for i in range(7)]
    r = client.post("/v2/work-sample/video", files=[("video", ("v.webm", b"v", "video/webm")), *many],
                    data={"student_id": "stu1", "rubric_id": "rb_stitching", "mode": "long"})
    assert r.status_code == 413


def test_long_video_is_sampled_more_thinly_after_30_minutes():
    part = gemini_video._video_part(b"x", "video/webm", 3600)
    assert part["video_metadata"] == {"fps": 0.5}
    assert "video_metadata" not in gemini_video._video_part(b"x", "video/webm", 1200)
    assert "video_metadata" not in gemini_video._video_part(b"x", "video/webm")
    assert "0:12:30" not in gemini_video._clips_text([{"at": 750, "why": "active"}])
    assert "12:30" in gemini_video._clips_text([{"at": 750, "why": "active"}])
