"""Deploys Proof Pays (verifier, Demo Rupee, escrow) and funds demo milestones.

    cd contracts && forge build                    # compile first
    anvil                                          # local chain, in another terminal (or use Sepolia)
    python scripts/deploy_contracts.py --rpc http://127.0.0.1:8545 --key <anvil key 0>
    python scripts/deploy_contracts.py --rpc $SEPOLIA_RPC_URL --key $DEPLOYER_KEY --explorer https://sepolia.etherscan.io

The issuer public key comes from ZK_ISSUER_KEY (the same key the API signs credentials with).
Writes contracts/deployments/<chain id>.json, which the API reads (CHAIN_DEPLOYMENT).
Test networks only: the Demo Rupee token refuses to mint on Ethereum mainnet.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
os.chdir(ROOT / "apps" / "api")

from app import settings  # noqa: E402,F401  (loads .env)
from app import chain  # noqa: E402
from app.zk import credential, eddsa  # noqa: E402
from eth_abi import encode  # noqa: E402
from eth_account import Account  # noqa: E402

OUT = ROOT / "contracts" / "out"

# Demo milestones: (name, sub-skill id, min level, min orders, max income band, required gender, amount, budget)
DEMO = [
    ("Stitching starter grant (girls, family income under Rs 2.5 lakh)", "ss_stitch_machine", 3, 3, 1, 1, 2000, 40000),
    ("Safe electrician step-up (anyone, income under Rs 3.5 lakh)", "ss_elec_safety", 3, 0, 2, 0, 1500, 30000),
    ("First customers bonus (anyone)", "ss_sell_customer", 2, 1, 15, 0, 500, 10000),
]


def artifact(name: str) -> tuple[str, list]:
    data = json.loads((OUT / f"{name}.sol" / f"{name}.json").read_text(encoding="utf-8"))
    return data["bytecode"]["object"], data["abi"]


def deploy(acct, name: str, types: list[str] | None = None, args: list | None = None) -> str:
    code, _ = artifact(name)
    data = bytes.fromhex(code.removeprefix("0x")) + (encode(types, args) if types else b"")
    rec = chain.send(data, None, acct, wait=True)["receipt"]
    addr = rec["contractAddress"]
    print(f"{name}: {addr}")
    return addr


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", required=True)
    ap.add_argument("--key", required=True, help="deployer key (test network only)")
    ap.add_argument("--explorer", default="")
    ap.add_argument("--public-rpc", default="", help="RPC URL phones and dashboards should use (default: --rpc)")
    ap.add_argument("--no-milestones", action="store_true")
    a = ap.parse_args()

    os.environ["CHAIN_RPC_URL"] = a.rpc
    key = eddsa.issuer_key()
    if not key:
        sys.exit("Set ZK_ISSUER_KEY first (hex, 32 bytes) - the same value the API uses.")
    ax, ay = eddsa.public_key(eddsa.secret_scalar(key))
    acct = Account.from_key(a.key)
    chain_id = int(chain.rpc("eth_chainId", []), 16)
    if chain_id == 1:
        sys.exit("Refusing to deploy demo money to Ethereum mainnet.")
    print(f"chain {chain_id}, deployer {acct.address}")

    verifier = deploy(acct, "Groth16Verifier")
    token = deploy(acct, "DemoRupee")
    pays = deploy(acct, "ProofPays", ["address", "address", "uint256", "uint256"], [verifier, token, ax, ay])
    block = int(chain.rpc("eth_blockNumber", []), 16)

    if not a.no_milestones:
        order = credential.subskill_order()
        total = sum(m[7] for m in DEMO)
        chain.send(chain.selector("mint(address,uint256)") + encode(["address", "uint256"], [acct.address, total]), token, acct, wait=True)
        chain.send(chain.selector("approve(address,uint256)") + encode(["address", "uint256"], [pays, total]), token, acct, wait=True)
        for name, sub, lvl, orders, income, gender, amount, budget in DEMO:
            data = chain.selector("createMilestone(string,uint8,uint8,uint32,uint8,uint8,uint256,uint256)") + encode(
                ["string", "uint8", "uint8", "uint32", "uint8", "uint8", "uint256", "uint256"],
                [name, order.index(sub), lvl, orders, income, gender, amount, budget])
            chain.send(data, pays, acct, wait=True)
            print(f"milestone: {name}")

    out = {"chain_id": chain_id, "rpc_url": a.public_rpc or a.rpc, "explorer": a.explorer, "verifier": verifier,
           "token": token, "proofpays": pays, "from_block": block, "issuer": [str(ax), str(ay)],
           "funder": acct.address, "abi_events": ["MilestoneFunded", "Paid", "Closed"]}
    folder = ROOT / "contracts" / "deployments"
    folder.mkdir(exist_ok=True)
    path = folder / f"{chain_id}.json"
    path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
