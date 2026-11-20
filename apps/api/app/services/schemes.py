"""The scheme catalogue the phones fetch (GET /v1/schemes), instead of only the copy bundled in the app.

Seed: packages/kb/schemes.json and rules/*.json. Rows in the scheme_catalog table (migrations/0010) add schemes,
replace a seed scheme with the same id, or hide one (active = false). An admin changes rows with PUT/DELETE
/v1/schemes/{id}; a new rule is accepted only if every one of its fixtures gives the expected answer.

Eligibility is still decided only by these json-logic rules, on the phone and here (services/eligibility.py).
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time

from .. import db, kb
from . import jsonlogic

log = logging.getLogger("disha.schemes")
TTL = 60.0
REQUIRED = ("id", "type", "provider", "name", "benefit_en", "required_documents", "apply_url", "source_url")

_lock = threading.Lock()
_cache: dict | None = None
_cache_at = 0.0


def _rows() -> list[dict] | None:
    try:
        with db.connect() as con:
            return list(con.execute("select id, scheme, rule, active, updated_at from scheme_catalog order by id"))
    except Exception as e:  # database down or table missing: the seed still works
        log.warning("scheme catalogue: using the bundled seed (%s)", str(e)[:120])
        return None


def _build() -> dict:
    schemes = {s["id"]: s for s in kb.schemes().values()}
    rules = {sid: r for sid, r in kb.rules().items()}
    rows = _rows()
    updated = None
    for r in rows or []:
        if r["active"]:
            schemes[r["id"]] = r["scheme"]
            rules[r["id"]] = r["rule"]
        else:
            schemes.pop(r["id"], None)
            rules.pop(r["id"], None)
        ts = r["updated_at"].isoformat()
        updated = max(updated or ts, ts)
    data = {"schemes": list(schemes.values()), "rules": [rules[s] for s in schemes if s in rules]}
    version = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:12]
    return {"version": version, "updated_at": updated, "source": "database" if rows else "seed", **data}


def catalog(fresh: bool = False) -> dict:
    global _cache, _cache_at
    with _lock:
        if fresh or _cache is None or time.monotonic() - _cache_at > TTL:
            _cache, _cache_at = _build(), time.monotonic()
        return _cache


def schemes() -> dict[str, dict]:
    return {s["id"]: s for s in catalog()["schemes"]}


def rules() -> dict[str, dict]:
    return {r["id"]: r for r in catalog()["rules"]}


def validate(scheme: dict, rule: dict) -> list[str]:
    """Problems with a new or changed scheme; empty when it may be published."""
    errs = [f"scheme.{k} missing" for k in REQUIRED if not scheme.get(k)]
    if not isinstance(scheme.get("name"), dict) or not scheme.get("name", {}).get("en"):
        errs.append("scheme.name.en missing")
    if rule.get("id") != scheme.get("id"):
        errs.append("rule.id must equal scheme.id")
    if not isinstance(rule.get("rule"), dict):
        errs.append("rule.rule must be a json-logic object")
        return errs
    fixtures = rule.get("fixtures") or []
    if not fixtures:
        errs.append("rule.fixtures: give at least one example with its expected answer")
    for i, fx in enumerate(fixtures):
        ev = jsonlogic.Evaluation()
        try:
            res = jsonlogic.apply(rule["rule"], fx.get("facts", {}), ev)
        except Exception as e:  # noqa: BLE001 - a broken rule is reported, not raised
            errs.append(f"fixture {i}: rule failed ({e})")
            continue
        got = "need_info" if res is jsonlogic.UNKNOWN else ("eligible" if res else "not_eligible")
        if got != fx.get("expected"):
            errs.append(f"fixture {i}: expected {fx.get('expected')}, rule gives {got}")
    return errs


def upsert(scheme: dict, rule: dict, by: str = "admin") -> None:
    with db.connect() as con:
        con.execute(
            "insert into scheme_catalog(id, scheme, rule, active, updated_at, updated_by) values (%s, %s, %s, true, now(), %s) "
            "on conflict (id) do update set scheme = excluded.scheme, rule = excluded.rule, active = true, "
            "updated_at = now(), updated_by = excluded.updated_by",
            (scheme["id"], json.dumps(scheme, ensure_ascii=False), json.dumps(rule, ensure_ascii=False), by))
    catalog(fresh=True)


def hide(scheme_id: str, by: str = "admin") -> None:
    s, r = schemes().get(scheme_id), rules().get(scheme_id)
    with db.connect() as con:
        con.execute(
            "insert into scheme_catalog(id, scheme, rule, active, updated_at, updated_by) values (%s, %s, %s, false, now(), %s) "
            "on conflict (id) do update set active = false, updated_at = now(), updated_by = excluded.updated_by",
            (scheme_id, json.dumps(s or {"id": scheme_id}), json.dumps(r or {"id": scheme_id}), by))
    catalog(fresh=True)
