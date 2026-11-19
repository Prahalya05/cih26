"""Writes packages/zk/test/fixtures.json: Poseidon outputs and a signed credential made by the Python code,
so the TypeScript and circomlibjs tests can check all three agree (like gen_golden.py for the engine)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.zk import credential, eddsa  # noqa: E402
from app.zk.poseidon import poseidon  # noqa: E402

TEST_KEY = "00" * 31 + "07"  # test-only issuer key


def main() -> None:
    inputs = {"1": [42], "2": [1, 2], "5": [1, 2, 3, 4, 5], "11": list(range(11, 22))}
    hashes = {n: str(poseidon(v)) for n, v in inputs.items()}
    fields = {"levels": credential.pack_levels({"ss_stitch_machine": 4, "ss_money_counting": 3}, credential.subskill_order()),
              "orders": 5, "earned_inr": 1750, "income_band": 1, "gender": 1, "category": 1, "birth_year": 2009,
              "issued_day": 20_400, "expires_day": 20_580, "holder": poseidon([123456789]), "serial": 987654321}
    cred = credential.issue(fields, TEST_KEY)
    cred.pop("issued_at")
    out = {"inputs": inputs, "hashes": hashes, "credential": cred, "holder_secret": "123456789",
           "issuer_public": [str(x) for x in eddsa.public_key(eddsa.secret_scalar(TEST_KEY))]}
    path = ROOT / "packages" / "zk" / "test" / "fixtures.json"
    path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
