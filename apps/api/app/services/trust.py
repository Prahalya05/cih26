"""Trust rules on the server. Keep in step with packages/engine/src/trust.ts (same thresholds, same answers).

identity_check  is it really her in the task video (liveness + face-match numbers computed on her phone)
auto_confirm    may the system confirm the AI's video score itself, or must a teacher look
pay_check       may a donor's money go to her
overrides       the latest teacher override per sub-skill
"""
from __future__ import annotations

IDENTITY_RULE = {"maxFaceDistance": 0.5, "minMatchedShare": 0.6, "livenessRequired": True}
AUTOCONFIRM_RULE = {"minKappa": 0.6, "maxCannotSee": 0.2, "auditShare": 0.1}
PAYCHECK_RULE = {"maxIncomeInr": 250_000, "needDocs": ["income_certificate", "ration_card_bpl", "scholarship_letter"]}
OVERRIDE_MIN_REASON = 8


def identity_check(x: dict) -> dict:
    liveness = x.get("liveness")
    live = None if not liveness else liveness.get("seen") == liveness.get("asked")
    why = [f"liveness: asked {liveness.get('asked')}, saw {liveness.get('seen')} {'✓' if live else '✗'}" if liveness else "liveness: not done ?"]
    if not x.get("enrolled"):
        why.append("no face enrolled → cannot compare ?")
        return {"status": "unknown", "matched_share": 0, "best_distance": None, "liveness_ok": live, "why": why}
    d = [float(v) for v in x.get("distances") or []]
    sampled = int(x.get("sampled") or 0)
    matched = sum(1 for v in d if v <= IDENTITY_RULE["maxFaceDistance"])
    share = matched / sampled if sampled else 0.0
    best = min(d) if d else None
    why.append(f"face match {matched}/{sampled} frames = {round(share * 100)}% (need ≥ {int(IDENTITY_RULE['minMatchedShare'] * 100)}%)")
    if sampled == 0 or not d:
        status = "unknown"
    elif share >= IDENTITY_RULE["minMatchedShare"] and (live is not False or not IDENTITY_RULE["livenessRequired"]):
        status = "unknown" if live is None and IDENTITY_RULE["livenessRequired"] else "verified"
    else:
        status = "mismatch"
    why.append(f"→ {status}")
    return {"status": status, "matched_share": round(share, 3), "best_distance": best, "liveness_ok": live, "why": why}


def draw_from_id(s: str) -> float:
    """FNV-1a, same as drawFromId in trust.ts."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h / 2**32


def auto_confirm(x: dict) -> dict:
    criteria = int(x.get("criteria") or 0)
    kappa = x.get("ai_kappa")
    checks = [
        (f"identity verified ({x.get('identity')})", x.get("identity") == "verified"),
        (f"no integrity flags ({', '.join(x.get('integrity_flags') or []) or 'none'})", not x.get("integrity_flags")),
        (f"no safety notes ({x.get('safety_flags', 0)})", int(x.get("safety_flags") or 0) == 0),
        (f"cannot-see {x.get('cannot_see', 0)}/{criteria} ≤ {int(AUTOCONFIRM_RULE['maxCannotSee'] * 100)}%",
         criteria > 0 and int(x.get("cannot_see") or 0) / criteria <= AUTOCONFIRM_RULE["maxCannotSee"]),
        (f"AI κ {'unknown' if kappa is None else f'{kappa:.2f}'} ≥ {AUTOCONFIRM_RULE['minKappa']}",
         kappa is not None and kappa >= AUTOCONFIRM_RULE["minKappa"]),
        ("not a hazardous task for a minor", not x.get("minor_hazard")),
    ]
    why = [f"{t} {'✓' if ok else '✗'}" for t, ok in checks]
    all_ok = all(ok for _, ok in checks)
    audited = float(x.get("audit_draw", 1)) < AUTOCONFIRM_RULE["auditShare"]
    if all_ok and audited:
        why.append(f"random spot check (draw {x['audit_draw']:.2f} < {AUTOCONFIRM_RULE['auditShare']}) → teacher")
    decision = "auto_confirm" if all_ok and not audited else "teacher"
    why.append("→ confirmed by the system; the teacher can still undo it" if decision == "auto_confirm" else "→ goes to the teacher's queue")
    return {"decision": decision, "why": why}


def overrides(events: list[dict]) -> dict[str, dict]:
    """Latest teacher override per sub-skill: {unit: {level, reason, at}}."""
    out: dict[str, dict] = {}
    for e in sorted(events, key=lambda e: (e["created_at"], e["id"])):
        p = e.get("payload") or {}
        if e["kind"] == "rating" and not e.get("refers_to") and p.get("override") is True:
            unit = e.get("subskill_id") or e.get("skill_id")
            if unit:
                out[unit] = {"level": p.get("level"), "reason": p.get("reason", ""), "at": e["created_at"]}
    return out


def pay_check(x: dict) -> dict:
    s = x["skill"]
    skill_ok = s["level"] >= s["needLevel"] and s["performance"] and not s["overriddenUp"]
    doc_ok = any(d in PAYCHECK_RULE["needDocs"] for d in x.get("verified_docs") or [])
    income = x.get("income_inr")
    income_ok = None if income is None else income <= PAYCHECK_RULE["maxIncomeInr"]
    ident = x.get("identity", "unknown")
    checks = [
        {"name": "skill", "ok": skill_ok,
         "detail": f"level {s['level']} ≥ {s['needLevel']}, shown by her own work"
                   + ("" if s["performance"] else " (no performance evidence)")
                   + (" (raised by override: not proof)" if s["overriddenUp"] else "")},
        {"name": "need", "ok": False if income_ok is False else (True if doc_ok else None),
         "detail": f"income ₹{income if income is not None else '?'} ≤ ₹{PAYCHECK_RULE['maxIncomeInr']:,} and a teacher saw "
                   f"one of {', '.join(PAYCHECK_RULE['needDocs'])} ({'seen' if doc_ok else 'not yet'})"},
        {"name": "consent", "ok": bool(x.get("consent_share")), "detail": "her family agreed to share her proof with funders"},
        {"name": "identity", "ok": True if ident in ("verified", "not_needed") else (False if ident == "mismatch" else None),
         "detail": f"the person in her task video is her ({ident})"},
        {"name": "once", "ok": not x.get("already_paid"), "detail": "not already paid for this milestone"},
    ]
    ok = all(c["ok"] is True for c in checks)
    why = [f"{c['name']}: {c['detail']} {'?' if c['ok'] is None else '✓' if c['ok'] else '✗'}" for c in checks]
    why.append("→ may be paid" if ok else "→ hold: not every check passed")
    return {"ok": ok, "checks": checks, "why": why}
