"""Baby Jubjub and EdDSA-Poseidon, verifiable by circomlib's EdDSAPoseidonVerifier and packages/zk.

Signing:  A = k*Base8 (public key), r = H(k, msg) mod l, R8 = r*Base8, hm = Poseidon(R8x, R8y, Ax, Ay, msg),
          S = r + 8*hm*k mod l.   Check: S*Base8 == R8 + (8*hm)*A.
The secret k comes from ZK_ISSUER_KEY (hex). Nonces are derived from the key and message (no randomness needed).
"""
from __future__ import annotations

import hashlib
import os

from .poseidon import P, poseidon

A_COEF = 168700
D_COEF = 168696
BASE8 = (5299619240641551281634865583518297030282874472190772894086521144482721001553,
         16950150798460657717958625567821834550301663161624707787222815936182638968203)
SUB_ORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041


def add(a: tuple[int, int], b: tuple[int, int]) -> tuple[int, int]:
    beta = a[0] * b[1] % P
    gamma = a[1] * b[0] % P
    delta = (a[1] - A_COEF * a[0]) * (b[0] + b[1]) % P
    dtau = D_COEF * beta * gamma % P
    x = (beta + gamma) * pow(1 + dtau, -1, P) % P
    y = (delta + A_COEF * beta - gamma) * pow((1 - dtau) % P, -1, P) % P
    return x, y


def mul(base: tuple[int, int], e: int) -> tuple[int, int]:
    res, exp = (0, 1), base
    while e > 0:
        if e & 1:
            res = add(res, exp)
        exp = add(exp, exp)
        e >>= 1
    return res


def on_curve(pt: tuple[int, int]) -> bool:
    x2, y2 = pt[0] * pt[0] % P, pt[1] * pt[1] % P
    return (A_COEF * x2 + y2 - 1 - D_COEF * x2 * y2) % P == 0


def secret_scalar(key_hex: str) -> int:
    k = int.from_bytes(hashlib.blake2b(bytes.fromhex(key_hex), person=b"disha-issuer-k").digest(), "little") % SUB_ORDER
    if k == 0:
        raise ValueError("bad issuer key")
    return k


def public_key(k: int) -> tuple[int, int]:
    return mul(BASE8, k)


def sign(k: int, msg: int) -> dict:
    nonce_in = k.to_bytes(32, "little") + (msg % P).to_bytes(32, "little")
    r = int.from_bytes(hashlib.blake2b(nonce_in, person=b"disha-nonce").digest(), "little") % SUB_ORDER
    R8 = mul(BASE8, r)
    A = public_key(k)
    hm = poseidon([R8[0], R8[1], A[0], A[1], msg])
    S = (r + 8 * hm * k) % SUB_ORDER
    return {"R8": R8, "S": S}


def verify(msg: int, sig: dict, pub: tuple[int, int]) -> bool:
    R8, S = tuple(sig["R8"]), int(sig["S"])
    if not on_curve(R8) or not on_curve(pub) or S >= SUB_ORDER:
        return False
    hm = poseidon([R8[0], R8[1], pub[0], pub[1], msg])
    return mul(BASE8, S) == add(R8, mul(pub, 8 * hm))


def issuer_key() -> str:
    """ZK_ISSUER_KEY as hex. Without it the API cannot issue credentials (503)."""
    return os.getenv("ZK_ISSUER_KEY", "").strip()
