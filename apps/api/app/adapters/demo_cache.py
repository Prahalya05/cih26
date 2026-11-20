"""Demo cache for AI answers, so a live demo survives bad Wi-Fi.

DEMO_CACHE=record  every successful AI answer is saved (keyed by task + a hash of the input) to DEMO_CACHE_FILE
DEMO_CACHE=1       a saved answer is replayed when the same input comes again (marked "cached");
                   new inputs still call the live AI
unset (default)    nothing is saved or replayed.
Never use with real students: the saved AI answers quote what the student said.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path

_lock = threading.Lock()


def mode() -> str:
    return (os.getenv("DEMO_CACHE") or "").strip().lower()


def _file() -> Path:
    return Path(os.getenv("DEMO_CACHE_FILE", str(Path(__file__).resolve().parents[2] / "demo_cache.json")))


def key(task: str, *parts: object) -> str:
    h = hashlib.sha256(task.encode())
    for p in parts:
        h.update(p if isinstance(p, bytes) else json.dumps(p, sort_keys=True, ensure_ascii=False).encode())
    return f"{task}:{h.hexdigest()[:24]}"


def _load() -> dict:
    try:
        return json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def get(k: str) -> dict | None:
    if mode() not in ("1", "true", "replay", "record"):
        return None
    return _load().get(k)


def put(k: str, value: dict) -> None:
    if mode() != "record":
        return
    with _lock:
        data = _load()
        data[k] = value
        _file().write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
