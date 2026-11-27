"""Proof Pays: skill credentials and proof-gated payouts.

POST /v2/credential     the server signs what the evidence shows (levels, buyer-confirmed orders) plus the
                        facts she declared; needs the share_portfolio consent. Her phone keeps it.
GET  /v2/pay/config     where the contract is, the issuer key and the open milestones
POST /v2/pay/claim      relays a zero-knowledge proof to the contract and pays the gas. The relayer cannot
                        change who is paid (the payout address is inside the proof).
GET  /v2/ai-rater       how far AI work-sample scores agree with teachers, and the weight that earns
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import chain, db
from ..auth import Device, device
from ..services import raters
from ..zk import credential, eddsa
from ..zk.poseidon import P

router = APIRouter(prefix="/v2", tags=["proof pays"])

DEC = r"^[0-9]{1,78}$"


class Facts(BaseModel):
    family_income_inr: int | None = Field(None, ge=0, le=100_000_000)
    gender: str | None = Field(None, max_length=10)
    category: str | None = Field(None, max_length=10)


class CredentialIn(BaseModel):
    student_id: str = Field(min_length=4, max_length=64)
    holder: str = Field(pattern=DEC, description="Poseidon(secret) made on her phone; the secret never leaves it")
    facts: Facts = Facts()


@router.post("/credential", summary="Sign a skill credential from the student's evidence (needs share_portfolio consent)")
def issue_credential(body: CredentialIn, dev: Device = Depends(device)):
    key = eddsa.issuer_key()
    if not key:
        raise HTTPException(503, "Credentials are not set up on this server (ZK_ISSUER_KEY)")
    if int(body.holder) >= P:
        raise HTTPException(422, "holder must be a field element")
    from .v2 import _row_to_event  # avoid an import cycle at module load
    with db.connect(dev.schools) as con:
        ok = con.execute("select 1 from consent where student_id = %s and revoked_at is null "
                         "and 'share_portfolio' = any(scopes)", (body.student_id,)).fetchone()
        if not ok:
            raise HTTPException(403, "She has not agreed to share her skill record")
        st = con.execute("select birth_year from student where id = %s", (body.student_id,)).fetchone()
        rows = con.execute("select * from evidence_event where student_id = %s order by created_at, id",
                           (body.student_id,)).fetchall()
        weights = {r["id"]: r["agreement"] for r in con.execute("select id, agreement from rater")}
    events = [_row_to_event(r) for r in rows]
    now_ms = datetime.now(tz=timezone.utc).timestamp() * 1000
    fields, levels = credential.build_fields(events, body.facts.model_dump(), int(body.holder),
                                             st["birth_year"] if st else None, now_ms, weights)
    cred = credential.issue(fields, key)
    return {"credential": cred, "levels": levels, "orders": fields["orders"], "earned_inr": fields["earned_inr"]}


@router.get("/pay/config", summary="Contract addresses, issuer key and open milestones")
def pay_config():
    issuer = credential.issuer_public()
    out = {"enabled": chain.enabled(), "issuer": [str(issuer[0]), str(issuer[1])] if issuer else None,
           "subskill_order": credential.subskill_order(), "milestones": []}
    if not chain.enabled():
        return out
    try:
        milestones = chain.milestones()
    except chain.ChainError as e:
        # Chain configured but not reachable (e.g. the committed local Anvil deployment on a server with no Anvil).
        # Report it as off and hand out no RPC address, or every visitor's browser would try to reach 127.0.0.1.
        out.update({"enabled": False, "error": str(e)})
        return out
    dep = chain.deployment()
    out.update({k: dep.get(k) for k in ("chain_id", "rpc_url", "explorer", "proofpays", "token", "from_block")})
    out["milestones"] = [{**m, "amount": int(m["amount"]), "budget": int(m["budget"]), "paid_count": int(m["paid_count"])}
                         for m in milestones]
    return out


class ProofIn(BaseModel):
    pi_a: list[str] = Field(min_length=2, max_length=3)
    pi_b: list[list[str]] = Field(min_length=2, max_length=3)
    pi_c: list[str] = Field(min_length=2, max_length=3)


class ClaimIn(BaseModel):
    milestone_id: int = Field(ge=1)
    payout: str = Field(pattern=r"^0x[0-9a-fA-F]{40}$")
    today: int = Field(ge=0)
    proof: ProofIn
    public_signals: list[str] = Field(min_length=11, max_length=11)


REASONS = {
    "AlreadyPaid": "This milestone was already paid for this student.",
    "InvalidProof": "The contract rejected the proof (it does not match this milestone or payout account).",
    "WrongDay": "The proof is dated for another day. Make a new one.",
    "OutOfBudget": "This milestone has no money left.",
    "NotOpen": "This milestone is closed.",
}


@router.post("/pay/claim", summary="Relay a zero-knowledge proof to the Proof Pays contract (gas paid by Disha)")
def relay_claim(body: ClaimIn, dev: Device = Depends(device)):
    if not chain.enabled():
        raise HTTPException(503, "Payouts are not set up on this server")
    try:
        p = body.proof
        a = [int(p.pi_a[0]), int(p.pi_a[1])]
        # snarkjs gives b as [[x1, x0], [y1, y0]] for the EVM pairing check
        b = [[int(p.pi_b[0][1]), int(p.pi_b[0][0])], [int(p.pi_b[1][1]), int(p.pi_b[1][0])]]
        c = [int(p.pi_c[0]), int(p.pi_c[1])]
        nullifier = int(body.public_signals[0])
    except ValueError:
        raise HTTPException(422, "Proof numbers must be decimal") from None
    try:
        sent = chain.claim(body.milestone_id, body.payout, body.today, nullifier, a, b, c)
    except chain.ChainError as e:
        raise HTTPException(409, {"reason": e.reason or "Rejected", "message": REASONS.get(e.reason or "", str(e))}) from None
    return {**sent, "explorer_url": chain.explorer_tx(sent["tx_hash"])}


@router.get("/ai-rater", summary="Agreement between AI work-sample scores and teacher checks")
def ai_rater():
    from .v2 import _row_to_event
    with db.connect() as con:
        rows = con.execute("select * from evidence_event where kind in ('work_sample', 'rating') "
                           "order by student_id, created_at, id").fetchall()
        stored = con.execute("select agreement from rater where id = %s", (raters.AI_RATER,)).fetchone()
    events = [_row_to_event(r) for r in rows]
    stats = raters.ai_agreement(events)
    return {**stats, "stored_weight": stored["agreement"] if stored else None, "min_pairs": raters.MIN_AI_PAIRS}
