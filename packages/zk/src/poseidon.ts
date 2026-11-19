// Poseidon hash over the BN254 scalar field, the same function as circomlib's poseidon.circom and
// circomlibjs. Plain BigInt, no WebAssembly, so it runs on any phone. Only the widths Disha uses are
// bundled (1, 2, 5 and 11 inputs). Keep in step with apps/api/app/zk/poseidon.py (checked by parity tests).

import constants from "./poseidon_constants.json" with { type: "json" };

export const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const mod = (a: bigint): bigint => {
  const r = a % P;
  return r < 0n ? r + P : r;
};

interface Width { partialRounds: number; C: bigint[]; M: bigint[][] }
const cache = new Map<number, Width>();

function width(t: number): Width {
  let w = cache.get(t);
  if (!w) {
    const raw = (constants.widths as Record<string, { partialRounds: number; C: string[]; M: string[][] }>)[String(t)];
    if (!raw) throw new Error(`Poseidon with ${t - 1} inputs is not bundled`);
    w = { partialRounds: raw.partialRounds, C: raw.C.map((x) => BigInt(x)), M: raw.M.map((row) => row.map((x) => BigInt(x))) };
    cache.set(t, w);
  }
  return w;
}

const pow5 = (a: bigint): bigint => {
  const a2 = (a * a) % P;
  return (((a2 * a2) % P) * a) % P;
};

/** Poseidon of 1, 2, 5 or 11 field elements. */
export function poseidon(inputs: (bigint | number | string)[]): bigint {
  const t = inputs.length + 1;
  const { partialRounds, C, M } = width(t);
  const full = constants.fullRounds;
  let state = [0n, ...inputs.map((x) => mod(BigInt(x)))];
  for (let r = 0; r < full + partialRounds; r++) {
    state = state.map((a, i) => (a + C[r * t + i]) % P);
    if (r < full / 2 || r >= full / 2 + partialRounds) state = state.map(pow5);
    else state[0] = pow5(state[0]);
    state = M.map((row) => row.reduce((acc, m, j) => (acc + m * state[j]) % P, 0n));
  }
  return state[0];
}
