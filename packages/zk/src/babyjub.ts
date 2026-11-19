// Baby Jubjub (the twisted Edwards curve inside BN254) and EdDSA-Poseidon signature checking, matching
// circomlib's eddsaposeidon.circom. Signing happens only on the server (apps/api/app/zk/eddsa.py).

import { mod, P, poseidon } from "./poseidon.ts";

export type Point = [bigint, bigint];

const A = 168700n;
const D = 168696n;
export const BASE8: Point = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];
export const SUB_ORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;

function inv(a: bigint): bigint {
  // Fermat: a^(P-2) mod P
  let result = 1n, base = mod(a), e = P - 2n;
  while (e > 0n) {
    if (e & 1n) result = (result * base) % P;
    base = (base * base) % P;
    e >>= 1n;
  }
  return result;
}

export function addPoint(a: Point, b: Point): Point {
  const beta = (a[0] * b[1]) % P;
  const gamma = (a[1] * b[0]) % P;
  const delta = mod((a[1] - A * a[0]) * (b[0] + b[1]));
  const dtau = (D * ((beta * gamma) % P)) % P;
  const x = ((beta + gamma) * inv(1n + dtau)) % P;
  const y = mod((delta + A * beta - gamma) * inv(mod(1n - dtau)));
  return [x, y];
}

export function mulPoint(base: Point, e: bigint): Point {
  let res: Point = [0n, 1n];
  let exp = base;
  let rem = e;
  while (rem > 0n) {
    if (rem & 1n) res = addPoint(res, exp);
    exp = addPoint(exp, exp);
    rem >>= 1n;
  }
  return res;
}

export function onCurve([x, y]: Point): boolean {
  const x2 = (x * x) % P, y2 = (y * y) % P;
  return mod(A * x2 + y2 - 1n - ((D * x2) % P) * y2) === 0n;
}

export interface Signature { R8: Point; S: bigint }

/** True when sig is a valid EdDSA-Poseidon signature of msg by public key pub. */
export function verifySignature(msg: bigint, sig: Signature, pub: Point): boolean {
  if (!onCurve(sig.R8) || !onCurve(pub) || sig.S >= SUB_ORDER) return false;
  const hm = poseidon([sig.R8[0], sig.R8[1], pub[0], pub[1], msg]);
  const left = mulPoint(BASE8, sig.S);
  const right = addPoint(sig.R8, mulPoint(pub, hm * 8n));
  return left[0] === right[0] && left[1] === right[1];
}
