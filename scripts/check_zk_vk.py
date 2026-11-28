"""Check that contracts/src/Groth16Verifier.sol and apps/web/public/zk/verification_key.json come from the same build.

Run:  python scripts/check_zk_vk.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOL_PATH = ROOT / "contracts" / "src" / "Groth16Verifier.sol"
VK_PATH = ROOT / "apps" / "web" / "public" / "zk" / "verification_key.json"


def check_vk_match(sol_path: Path = SOL_PATH, vk_path: Path = VK_PATH) -> list[str]:
    """Return a list of mismatch descriptions (empty list means exact match)."""
    sol = sol_path.read_text(encoding="utf-8")
    vk = json.loads(vk_path.read_text(encoding="utf-8"))
    consts = {m.group(1): m.group(2) for m in re.finditer(r"uint256\s+constant\s+(\w+)\s*=\s*(\d+)\s*;", sol)}

    expected: dict[str, str] = {
        "alphax": str(vk["vk_alpha_1"][0]),
        "alphay": str(vk["vk_alpha_1"][1]),
        # snarkjs Solidity template swaps Fq2 [c0, c1] -> x1=c1, x2=c0
        "betax1": str(vk["vk_beta_2"][0][1]),
        "betax2": str(vk["vk_beta_2"][0][0]),
        "betay1": str(vk["vk_beta_2"][1][1]),
        "betay2": str(vk["vk_beta_2"][1][0]),
        "gammax1": str(vk["vk_gamma_2"][0][1]),
        "gammax2": str(vk["vk_gamma_2"][0][0]),
        "gammay1": str(vk["vk_gamma_2"][1][1]),
        "gammay2": str(vk["vk_gamma_2"][1][0]),
        "deltax1": str(vk["vk_delta_2"][0][1]),
        "deltax2": str(vk["vk_delta_2"][0][0]),
        "deltay1": str(vk["vk_delta_2"][1][1]),
        "deltay2": str(vk["vk_delta_2"][1][0]),
    }
    for i, pt in enumerate(vk["IC"]):
        expected[f"IC{i}x"] = str(pt[0])
        expected[f"IC{i}y"] = str(pt[1])

    problems: list[str] = []
    if len(vk["IC"]) != int(vk["nPublic"]) + 1:
        problems.append(f"IC length {len(vk['IC'])} != nPublic + 1 ({int(vk['nPublic']) + 1})")
    for name, val in expected.items():
        if name not in consts:
            problems.append(f"missing constant {name} in {sol_path.name}")
        elif consts[name] != val:
            problems.append(f"{name} mismatch between {sol_path.name} and {vk_path.name}")
    if f"IC{len(vk['IC'])}x" in consts:
        problems.append(f"{sol_path.name} has more IC points than {vk_path.name}")
    return problems


def main() -> int:
    problems = check_vk_match()
    if problems:
        for p in problems:
            print("FAIL", p)
        return 1
    vk = json.loads(VK_PATH.read_text(encoding="utf-8"))
    print(f"ok: Groth16Verifier.sol matches verification_key.json ({vk['nPublic']} public signals, {len(vk['IC'])} IC points)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
