"""Initialize DemoRupee (80,000 DRU) and the 3 demo milestones on an EXISTING ProofPays deployment.

Never deploys new contracts. Targets contracts/deployments/<chain>.json:

    python scripts/init_milestones.py --chain 11155111 --key $DEPLOYER_KEY
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
from app.zk import credential  # noqa: E402
from deploy_contracts import DEMO  # noqa: E402
from eth_abi import encode  # noqa: E402
from eth_account import Account  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", default="11155111", help="chain id (reads contracts/deployments/<chain>.json)")
    ap.add_argument("--key", default="", help="wallet private key (defaults to DEPLOYER_KEY or RELAYER_PRIVATE_KEY env)")
    ap.add_argument("--rpc", default="", help="override CHAIN_RPC_URL")
    args = ap.parse_args()

    dep_path = ROOT / "contracts" / "deployments" / f"{args.chain}.json"
    if not dep_path.is_file():
        sys.exit(f"Deployment file not found: {dep_path}")
    dep = json.loads(dep_path.read_text(encoding="utf-8"))

    os.environ["CHAIN_ID"] = str(args.chain)
    if args.rpc:
        os.environ["CHAIN_RPC_URL"] = args.rpc
    elif not os.getenv("CHAIN_RPC_URL") and dep.get("rpc_url"):
        os.environ["CHAIN_RPC_URL"] = dep["rpc_url"]
    chain.deployment.cache_clear()

    priv = (args.key or os.getenv("DEPLOYER_KEY") or os.getenv("RELAYER_PRIVATE_KEY") or "").strip()
    if not priv:
        sys.exit("Pass --key <private_key> or set DEPLOYER_KEY / RELAYER_PRIVATE_KEY.")
    acct = Account.from_key(priv)

    live_chain = int(chain.rpc("eth_chainId", []), 16)
    if live_chain != int(dep["chain_id"]):
        sys.exit(f"Chain ID mismatch: RPC={live_chain}, expected={dep['chain_id']}")

    token = dep["token"]
    pays = dep["proofpays"]
    (existing_count,) = chain.call(pays, "milestoneCount()", [], [], ["uint256"])
    print(f"chain={live_chain}, signer={acct.address}, existing milestones={existing_count}")
    if existing_count >= len(DEMO):
        print("All demo milestones already exist on-chain; nothing to create.")
        return 0

    remaining = DEMO[existing_count:]
    needed = sum(m[7] for m in remaining)
    (bal,) = chain.call(token, "balanceOf(address)", ["address"], [acct.address], ["uint256"])
    if bal < needed:
        mint_amt = needed - bal
        print(f"Minting {mint_amt} DRU to {acct.address}...")
        chain.send(chain.selector("mint(address,uint256)") + encode(["address", "uint256"], [acct.address, mint_amt]),
                   token, acct, wait=True)

    (allow,) = chain.call(token, "allowance(address,address)", ["address", "address"], [acct.address, pays], ["uint256"])
    if allow < needed:
        print(f"Approving ProofPays ({pays}) for {needed} DRU...")
        chain.send(chain.selector("approve(address,uint256)") + encode(["address", "uint256"], [pays, needed]),
                   token, acct, wait=True)

    order = credential.subskill_order()
    for name, sub, lvl, orders, income, gender, amount, budget in remaining:
        data = chain.selector("createMilestone(string,uint8,uint8,uint32,uint8,uint8,uint256,uint256)") + encode(
            ["string", "uint8", "uint8", "uint32", "uint8", "uint8", "uint256", "uint256"],
            [name, order.index(sub), lvl, orders, income, gender, amount, budget],
        )
        chain.send(data, pays, acct, wait=True)
        print(f"Created milestone: {name}")

    (final_count,) = chain.call(pays, "milestoneCount()", [], [], ["uint256"])
    (final_bal,) = chain.call(token, "balanceOf(address)", ["address"], [acct.address], ["uint256"])
    (final_allow,) = chain.call(token, "allowance(address,address)", ["address", "address"], [acct.address, pays], ["uint256"])
    print(f"Done: milestoneCount={final_count}, signer_dru_balance={final_bal}, allowance={final_allow}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
