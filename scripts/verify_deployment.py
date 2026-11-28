"""Verify a Proof Pays deployment against the live RPC and the API's ZK_ISSUER_KEY.

Run:
    python scripts/verify_deployment.py --chain 11155111
    python scripts/verify_deployment.py --deployment contracts/deployments/11155111.json --rpc https://...
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "scripts"))

from app import settings  # noqa: E402,F401  (loads .env)
from app import chain  # noqa: E402
from app.zk import eddsa  # noqa: E402
import check_zk_vk  # noqa: E402


def _load_deployment(chain_arg: str, dep_arg: str) -> tuple[Path, dict]:
    if dep_arg:
        p = Path(dep_arg)
        if not p.is_file():
            p = ROOT / dep_arg
    elif chain_arg:
        p = ROOT / "contracts" / "deployments" / f"{chain_arg}.json"
    elif os.getenv("CHAIN_DEPLOYMENT"):
        p = Path(os.environ["CHAIN_DEPLOYMENT"])
        if not p.is_file():
            p = ROOT / os.environ["CHAIN_DEPLOYMENT"]
    elif os.getenv("CHAIN_ID"):
        p = ROOT / "contracts" / "deployments" / f"{os.environ['CHAIN_ID'].strip()}.json"
    else:
        files = sorted((ROOT / "contracts" / "deployments").glob("*.json"))
        if len(files) != 1:
            raise FileNotFoundError("Specify --chain <id> or --deployment <path>")
        p = files[0]
    if not p.is_file():
        raise FileNotFoundError(f"Deployment file not found: {p}")
    return p, json.loads(p.read_text(encoding="utf-8"))


def verify(dep: dict, rpc_override: str = "") -> list[str]:
    """Run all deployment checks; returns a list of failure messages (empty = all passed)."""
    failures: list[str] = []

    vk_problems = check_zk_vk.check_vk_match()
    failures.extend(vk_problems)

    if rpc_override:
        os.environ["CHAIN_RPC_URL"] = rpc_override
    elif not os.getenv("CHAIN_RPC_URL") and dep.get("rpc_url"):
        os.environ["CHAIN_RPC_URL"] = dep["rpc_url"]

    try:
        live_chain_id = int(chain.rpc("eth_chainId", []), 16)
        if live_chain_id != int(dep["chain_id"]):
            failures.append(f"chain_id mismatch: RPC={live_chain_id}, deployment={dep['chain_id']}")
        else:
            print(f"ok: chain_id={live_chain_id}")
    except Exception as exc:
        failures.append(f"eth_chainId failed: {exc}")
        return failures

    for key in ("verifier", "token", "proofpays"):
        addr = dep.get(key)
        if not addr:
            failures.append(f"missing {key} address in deployment json")
            continue
        code = chain.rpc("eth_getCode", [addr, "latest"])
        if not code or code == "0x":
            failures.append(f"no contract code at {key}={addr}")
        else:
            print(f"ok: {key} code present at {addr}")

    try:
        (m_count,) = chain.call(dep["proofpays"], "milestoneCount()", [], [], ["uint256"])
        print(f"ok: milestoneCount={m_count}")
    except Exception as exc:
        failures.append(f"milestoneCount() failed: {exc}")

    acct = chain.relayer()
    if acct is None:
        failures.append("RELAYER_PRIVATE_KEY is not set")
    else:
        bal = int(chain.rpc("eth_getBalance", [acct.address, "latest"]), 16)
        if bal <= 0:
            failures.append(f"relayer {acct.address} has 0 balance")
        else:
            print(f"ok: relayer {acct.address} balance={bal} wei")

    issuer_key = eddsa.issuer_key()
    if not issuer_key:
        failures.append("ZK_ISSUER_KEY is not set")
    else:
        api_ax, api_ay = eddsa.public_key(eddsa.secret_scalar(issuer_key))
        try:
            (c_ax,) = chain.call(dep["proofpays"], "issuerAx()", [], [], ["uint256"])
            (c_ay,) = chain.call(dep["proofpays"], "issuerAy()", [], [], ["uint256"])
            if (api_ax, api_ay) != (c_ax, c_ay):
                failures.append(f"issuer key mismatch: API=({api_ax}, {api_ay}) != contract=({c_ax}, {c_ay})")
            else:
                print(f"ok: issuerAx/issuerAy match ZK_ISSUER_KEY ({api_ax}, {api_ay})")
        except Exception as exc:
            failures.append(f"issuerAx()/issuerAy() call failed: {exc}")

    return failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", default="", help="chain id (reads contracts/deployments/<chain>.json)")
    ap.add_argument("--deployment", default="", help="explicit path to deployment json")
    ap.add_argument("--rpc", default="", help="override CHAIN_RPC_URL")
    args = ap.parse_args()

    try:
        path, dep = _load_deployment(args.chain, args.deployment)
    except FileNotFoundError as exc:
        print("FAIL", exc)
        return 1

    print(f"Verifying deployment {path.relative_to(ROOT)}...")
    failures = verify(dep, args.rpc)
    for f in failures:
        print("FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
