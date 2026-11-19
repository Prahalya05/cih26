"""A small Ethereum JSON-RPC client for the Proof Pays contract: read milestones, relay claims, deploy.

Configuration (environment, or the deployment file written by scripts/deploy_contracts.py):
  CHAIN_RPC_URL          e.g. http://127.0.0.1:8545 (Anvil) or a free public Sepolia RPC
  CHAIN_DEPLOYMENT       path to contracts/deployments/<chain id>.json (addresses, explorer)
  RELAYER_PRIVATE_KEY    test-network key that pays gas for students (never a key holding real money)
The relayer cannot cheat: the contract checks every proof, and the proof fixes the payout address.
"""
from __future__ import annotations

import json
import os
import time
from functools import lru_cache
from pathlib import Path

import httpx
from eth_abi import decode, encode
from eth_account import Account
from eth_utils import keccak, to_checksum_address

ROOT = Path(__file__).resolve().parents[3]
TIMEOUT = 20.0

ERRORS = ["BadMilestone()", "NotOpen()", "AlreadyPaid()", "OutOfBudget()", "WrongDay()", "InvalidProof()",
          "NotFunder()", "TransferFailed()"]
ERROR_BY_SELECTOR = {"0x" + keccak(text=e)[:4].hex(): e[:-2] for e in ERRORS}

MILESTONE_OUT = ["address", "string", "uint8", "uint8", "uint32", "uint8", "uint8", "uint256", "uint256", "uint256", "bool"]
MILESTONE_KEYS = ["funder", "name", "subskill_index", "min_level", "min_orders", "max_income_band", "required_gender",
                  "amount", "budget", "paid_count", "open"]


class ChainError(Exception):
    def __init__(self, message: str, reason: str | None = None):
        super().__init__(message)
        self.reason = reason


def selector(sig: str) -> bytes:
    return keccak(text=sig)[:4]


@lru_cache(maxsize=1)
def deployment() -> dict:
    path = os.getenv("CHAIN_DEPLOYMENT", "")
    if path and Path(path).is_file():
        return json.loads(Path(path).read_text(encoding="utf-8"))
    folder = ROOT / "contracts" / "deployments"
    files = sorted(folder.glob("*.json")) if folder.is_dir() else []
    return json.loads(files[0].read_text(encoding="utf-8")) if len(files) == 1 else {}


def rpc_url() -> str:
    return os.getenv("CHAIN_RPC_URL", "") or deployment().get("rpc_url", "")


def enabled() -> bool:
    return bool(rpc_url() and deployment().get("proofpays"))


def rpc(method: str, params: list):
    url = rpc_url()
    if not url:
        raise ChainError("No CHAIN_RPC_URL set")
    try:
        r = httpx.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=TIMEOUT)
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise ChainError(f"RPC {method} failed: {type(e).__name__}") from e
    if "error" in body:
        err = body["error"]
        data = err.get("data")
        if isinstance(data, dict):
            data = data.get("data")
        reason = ERROR_BY_SELECTOR.get(str(data)[:10]) if isinstance(data, str) else None
        raise ChainError(f"{method}: {err.get('message', 'error')}", reason)
    return body["result"]


def call(to: str, sig: str, types: list[str], args: list, out: list[str]):
    data = "0x" + (selector(sig) + encode(types, args)).hex()
    res = rpc("eth_call", [{"to": to, "data": data}, "latest"])
    return decode(out, bytes.fromhex(res[2:]))


def relayer() -> Account | None:
    key = os.getenv("RELAYER_PRIVATE_KEY", "").strip()
    return Account.from_key(key) if key else None


def send(data: bytes, to: str | None = None, account=None, wait: bool = False) -> dict:
    """Simulates, signs and sends a transaction. Reverts come back as ChainError with the contract's reason."""
    acct = account or relayer()
    if acct is None:
        raise ChainError("No RELAYER_PRIVATE_KEY set")
    tx = {"from": acct.address, "data": "0x" + data.hex()}
    if to:
        tx["to"] = to
    gas = int(rpc("eth_estimateGas", [tx]), 16)  # also catches reverts before spending anything
    base = int(rpc("eth_gasPrice", []), 16)
    signed = acct.sign_transaction({
        "type": 2, "chainId": int(rpc("eth_chainId", []), 16),
        "nonce": int(rpc("eth_getTransactionCount", [acct.address, "pending"]), 16),
        "to": to_checksum_address(to) if to else b"", "data": tx["data"], "value": 0,
        "gas": int(gas * 1.2) + 10_000, "maxFeePerGas": base * 2 + 1, "maxPriorityFeePerGas": max(1, base // 10),
    })
    raw = signed.raw_transaction.hex()
    tx_hash = rpc("eth_sendRawTransaction", ["0x" + raw.removeprefix("0x")])
    out = {"tx_hash": tx_hash}
    if wait:
        out["receipt"] = wait_receipt(tx_hash)
    return out


def wait_receipt(tx_hash: str, timeout_s: float = 90) -> dict:
    end = time.time() + timeout_s
    while time.time() < end:
        rec = rpc("eth_getTransactionReceipt", [tx_hash])
        if rec:
            if rec.get("status") != "0x1":
                raise ChainError(f"transaction {tx_hash} reverted")
            return rec
        time.sleep(1)
    raise ChainError(f"no receipt for {tx_hash} after {timeout_s:.0f} s")


# ---------- Proof Pays ----------

def proofpays() -> str:
    return deployment()["proofpays"]


def milestones() -> list[dict]:
    pp = proofpays()
    (count,) = call(pp, "milestoneCount()", [], [], ["uint256"])
    out = []
    for i in range(1, count + 1):
        vals = call(pp, "milestones(uint256)", ["uint256"], [i], MILESTONE_OUT)
        m = dict(zip(MILESTONE_KEYS, vals))
        m["id"] = i
        out.append(m)
    return out


def claim(milestone_id: int, payout: str, today: int, nullifier: int, a: list[int], b: list[list[int]], c: list[int]) -> dict:
    data = selector("claim(uint256,address,uint256,uint256,uint256[2],uint256[2][2],uint256[2])") + encode(
        ["uint256", "address", "uint256", "uint256", "uint256[2]", "uint256[2][2]", "uint256[2]"],
        [milestone_id, to_checksum_address(payout), today, nullifier, a, b, c])
    return send(data, proofpays())


def explorer_tx(tx_hash: str) -> str | None:
    base = deployment().get("explorer")
    return f"{base.rstrip('/')}/tx/{tx_hash}" if base else None
