"""Spoken Tamil (and Hindi/English) for phones that have no Tamil voice installed.

Many low-cost Android phones ship without a Tamil text-to-speech voice, so the app would fall silent for students
who cannot read. The phone asks for /v1/tts only then; the answer is a small WAV cached here and on the phone.
Uses Gemini's speech model (GEMINI_TTS_MODEL). Text only: no student data is sent, only screen prompts.
"""
from __future__ import annotations

import base64
import hashlib
import io
import os
import wave
from collections import OrderedDict

import httpx

from .gemini import API, GeminiUnavailable, api_key

TIMEOUT = 25.0
MAX_CHARS = 400
_cache: OrderedDict[str, bytes] = OrderedDict()
CACHE_MAX = 300

LANG_NAME = {"ta": "Tamil", "hi": "Hindi", "en": "Indian English"}


def _model() -> str:
    return os.getenv("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")


def _wav(pcm: bytes, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def speak(text: str, lang: str) -> bytes:
    text = text.strip()[:MAX_CHARS]
    key = hashlib.sha256(f"{lang}|{text}".encode()).hexdigest()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    k = api_key()
    if not k:
        raise GeminiUnavailable("GEMINI_API_KEY not set")
    body = {
        "contents": [{"parts": [{"text": f"Read this aloud slowly and warmly, in {LANG_NAME.get(lang, 'Tamil')}, "
                                         f"for a teenager in a village: {text}"}]}],
        "generationConfig": {"responseModalities": ["AUDIO"],
                             "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": os.getenv("GEMINI_TTS_VOICE", "Kore")}}}},
    }
    try:
        r = httpx.post(API.format(model=_model()), json=body, headers={"x-goog-api-key": k}, timeout=TIMEOUT)
        r.raise_for_status()
        part = r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
        mime = part.get("mimeType", "")
        rate = int(mime.split("rate=")[1].split(";")[0]) if "rate=" in mime else 24000
        audio = _wav(base64.b64decode(part["data"]), rate)
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
        raise GeminiUnavailable(f"tts: {type(e).__name__}") from e
    _cache[key] = audio
    if len(_cache) > CACHE_MAX:
        _cache.popitem(last=False)
    return audio
