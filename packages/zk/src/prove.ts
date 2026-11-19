// Making and checking a Groth16 proof with snarkjs. snarkjs is passed in (the phone loads its browser
// build from /zk/snarkjs.min.js; Node tests import the package), so this file has no bundler tricks.

import { circuitInputs, nullifierOf, type Credential, type Milestone } from "./credential.ts";

export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface SnarkJs {
  groth16: {
    fullProve(input: object, wasm: string | Uint8Array, zkey: string | Uint8Array): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify(vkey: object, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
  };
}

/** Order of public signals: the nullifier (output) first, then the public inputs as declared in the circuit. */
export const PUBLIC_SIGNALS = [
  "nullifier", "issuerAx", "issuerAy", "milestoneId", "subskillIndex", "minLevel", "minOrders",
  "maxIncomeBand", "requiredGender", "today", "payout",
] as const;

export interface SkillProof {
  proof: Groth16Proof;
  publicSignals: string[];
  ms: number;
}

export async function proveMilestone(snarkjs: SnarkJs, wasm: string | Uint8Array, zkey: string | Uint8Array,
  cred: Credential, secret: bigint, m: Milestone, payout: bigint, today: number): Promise<SkillProof> {
  const t0 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs(cred, secret, m, payout, today), wasm, zkey);
  if (publicSignals[0] !== nullifierOf(secret, m.id).toString()) throw new Error("unexpected public signal order");
  return { proof, publicSignals, ms: Math.round(performance.now() - t0) };
}

/** Names the public signals so a person can read what was proved. */
export function readPublic(publicSignals: string[]): Record<(typeof PUBLIC_SIGNALS)[number], string> {
  return Object.fromEntries(PUBLIC_SIGNALS.map((k, i) => [k, publicSignals[i]])) as Record<(typeof PUBLIC_SIGNALS)[number], string>;
}

/** Proof as the arguments of the Solidity verifier: a, b (coordinates swapped as the EVM pairing expects), c. */
export function solidityArgs(p: Groth16Proof): { a: [bigint, bigint]; b: [[bigint, bigint], [bigint, bigint]]; c: [bigint, bigint] } {
  return {
    a: [BigInt(p.pi_a[0]), BigInt(p.pi_a[1])],
    b: [[BigInt(p.pi_b[0][1]), BigInt(p.pi_b[0][0])], [BigInt(p.pi_b[1][1]), BigInt(p.pi_b[1][0])]],
    c: [BigInt(p.pi_c[0]), BigInt(p.pi_c[1])],
  };
}
