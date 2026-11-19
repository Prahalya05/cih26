"""Issues the Disha skill credential: 11 numbers, hashed with Poseidon and signed with EdDSA-Poseidon.

What is attested and how:
  levels, orders, earned_inr   worked out by the server from the student's evidence events (the same tracing
                               as everywhere else); orders count only buyer-confirmed paid jobs
  income_band, gender, category, birth_year   as declared by the student or guardian (marked self-declared)
  holder                       Poseidon(secret) sent by her phone; the server never sees the secret
Field order must match packages/zk/src/credential.ts and packages/zk/circuits/skill_proof.circom.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from .. import kb
from ..services import tracing
from . import eddsa
from .poseidon import P, poseidon

VERSION = 1
MAX_SUBSKILLS = 32
UNKNOWN_INCOME = 15
VALID_DAYS = 180
FIELD_ORDER = ["levels", "orders", "earned_inr", "income_band", "gender", "category", "birth_year",
               "issued_day", "expires_day", "holder", "serial"]
INCOME_BANDS = [(0, 100_000), (1, 250_000), (2, 350_000), (3, 800_000), (4, float("inf"))]
GENDERS = {"female": 1, "male": 2, "other": 3}
CATEGORIES = {"sc": 1, "st": 2, "mbc": 3, "bc": 4, "general": 5}
DAY_MS = 86_400_000


def subskill_order() -> list[str]:
    """Stable order of the sub-skills inside the packed levels field (alphabetical ids, at most 32)."""
    return sorted(kb.graph()["subskills"])[:MAX_SUBSKILLS]


def income_band(income) -> int:
    if not isinstance(income, (int, float)) or isinstance(income, bool):
        return UNKNOWN_INCOME
    return next(b for b, mx in INCOME_BANDS if income < mx)


def pack_levels(levels: dict[str, int], order: list[str]) -> int:
    packed = 0
    for i, sid in enumerate(order[:MAX_SUBSKILLS]):
        level = min(4, max(1, int(round(levels.get(sid, 1)))))
        packed |= (level - 1) << (2 * i)
    return packed


def confirmed_orders(events: list[dict]) -> tuple[int, int]:
    """(count, rupees) of paid jobs the buyer confirmed through the one-time link."""
    by_id = {e["id"]: e for e in events}
    seen: set[str] = set()
    n = total = 0
    for e in events:
        target = by_id.get(e.get("refers_to") or "")
        if e["kind"] == "rating" and target and target["kind"] == "order" and target["id"] not in seen:
            seen.add(target["id"])
            n += 1
            total += int((target.get("payload") or {}).get("amount_inr") or 0)
    return n, total


def build_fields(events: list[dict], facts: dict, holder: int, birth_year: int | None, now_ms: float,
                 rater_weights: dict | None = None) -> tuple[dict, dict]:
    """The credential fields, and the levels they encode (for showing the student what she is sharing)."""
    profile = tracing.fold_events(events, {"now": now_ms, "items": kb.items(), "rubrics": kb.rubrics(),
                                           "raterWeights": rater_weights or {}})
    order = subskill_order()
    levels = {sid: profile["units"][sid]["level"] for sid in order if sid in profile["units"]}
    n_orders, earned = confirmed_orders(events)
    today = int(now_ms // DAY_MS)
    fields = {
        "levels": pack_levels(levels, order),
        "orders": n_orders,
        "earned_inr": earned,
        "income_band": income_band(facts.get("family_income_inr")),
        "gender": GENDERS.get(str(facts.get("gender") or ""), 0),
        "category": CATEGORIES.get(str(facts.get("category") or ""), 0),
        "birth_year": int(birth_year or 0),
        "issued_day": today,
        "expires_day": today + VALID_DAYS,
        "holder": int(holder) % P,
        "serial": secrets.randbelow(P),
    }
    return fields, levels


def credential_hash(fields: dict) -> int:
    return poseidon([int(fields[k]) for k in FIELD_ORDER])


def issue(fields: dict, key_hex: str) -> dict:
    k = eddsa.secret_scalar(key_hex)
    pub = eddsa.public_key(k)
    sig = eddsa.sign(k, credential_hash(fields))
    return {
        "version": VERSION,
        "fields": {k2: str(fields[k2]) for k2 in FIELD_ORDER},
        "subskill_order": subskill_order(),
        "signature": {"R8": [str(sig["R8"][0]), str(sig["R8"][1])], "S": str(sig["S"])},
        "issuer": [str(pub[0]), str(pub[1])],
        "self_declared": ["income_band", "gender", "category", "birth_year"],
        "issued_at": datetime.now(tz=timezone.utc).isoformat(),
    }


def verify(cred: dict) -> bool:
    fields = {k: int(v) for k, v in cred["fields"].items()}
    sig = {"R8": (int(cred["signature"]["R8"][0]), int(cred["signature"]["R8"][1])), "S": int(cred["signature"]["S"])}
    pub = (int(cred["issuer"][0]), int(cred["issuer"][1]))
    return eddsa.verify(credential_hash(fields), sig, pub)


def issuer_public() -> tuple[int, int] | None:
    key = eddsa.issuer_key()
    return eddsa.public_key(eddsa.secret_scalar(key)) if key else None
