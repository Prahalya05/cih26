"""The model list: an overloaded or slow model is skipped for the next one; a bad request is not retried."""
import httpx
import pytest

from app.adapters import gemini


def _resp(status: int, text: str = '{"ok": 1}') -> httpx.Response:
    req = httpx.Request("POST", "https://example.test")
    body = {"candidates": [{"content": {"parts": [{"text": text}]}}]} if status == 200 else {"error": "x"}
    return httpx.Response(status, json=body, request=req)


def test_skips_overloaded_and_slow_models(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "busy, slow, good")
    tried = []

    def fake_post(url, **kw):
        tried.append(url.split("/models/")[1].split(":")[0])
        if "busy" in url:
            return _resp(503)
        if "slow" in url:
            raise httpx.ReadTimeout("timed out")
        return _resp(200)

    monkeypatch.setattr(gemini.httpx, "post", fake_post)
    monkeypatch.setattr(gemini.time, "sleep", lambda s: None)
    data, model = gemini.generate({})
    assert (data, model) == ({"ok": 1}, "good")
    assert tried == ["busy", "slow", "good"]


def test_bad_request_is_not_retried(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "a,b")
    tried = []
    monkeypatch.setattr(gemini.httpx, "post", lambda url, **kw: tried.append(url) or _resp(400))
    with pytest.raises(gemini.GeminiUnavailable):
        gemini.generate({})
    assert len(tried) == 1


def test_second_pass_retries_busy_but_not_slow(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "busy,slow")
    monkeypatch.setattr(gemini.time, "sleep", lambda s: None)
    tried = []

    def fake_post(url, **kw):
        name = url.split("/models/")[1].split(":")[0]
        tried.append(name)
        if name == "slow":
            raise httpx.ReadTimeout("timed out")
        return _resp(503) if tried.count("busy") == 1 else _resp(200)

    monkeypatch.setattr(gemini.httpx, "post", fake_post)
    assert gemini.generate({})[1] == "busy"
    assert tried == ["busy", "slow", "busy"]
