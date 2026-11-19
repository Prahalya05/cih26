"""Poseidon hash over the BN254 scalar field, identical to circomlib/circomlibjs (widths 1, 2, 5, 11 inputs)."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

P = 21888242871839275222246405745257275088548364400416034343698204186575808495617

CONSTANTS = Path(os.getenv("ZK_CONSTANTS", Path(__file__).resolve().parents[4] / "packages" / "zk" / "src" / "poseidon_constants.json"))


@lru_cache(maxsize=1)
def _constants() -> dict:
    return json.loads(CONSTANTS.read_text(encoding="utf-8"))


@lru_cache(maxsize=8)
def _width(t: int) -> tuple[int, list[int], list[list[int]]]:
    raw = _constants()["widths"].get(str(t))
    if raw is None:
        raise ValueError(f"Poseidon with {t - 1} inputs is not bundled")
    return raw["partialRounds"], [int(x, 16) for x in raw["C"]], [[int(x, 16) for x in row] for row in raw["M"]]


def poseidon(inputs: list[int]) -> int:
    t = len(inputs) + 1
    partial, C, M = _width(t)
    full = _constants()["fullRounds"]
    state = [0] + [int(x) % P for x in inputs]
    for r in range(full + partial):
        state = [(a + C[r * t + i]) % P for i, a in enumerate(state)]
        if r < full // 2 or r >= full // 2 + partial:
            state = [pow(a, 5, P) for a in state]
        else:
            state[0] = pow(state[0], 5, P)
        state = [sum(m * s for m, s in zip(row, state)) % P for row in M]
    return state[0]
