// PROVE and PAY on the phone.
//
// 1. A random secret is made on her phone and never leaves it; the server only sees Poseidon(secret).
// 2. The server signs a credential from her evidence (POST /v2/credential). The phone checks the signature.
// 3. For a funder's milestone, the phone makes a Groth16 zero-knowledge proof (snarkjs, WebAssembly) that the
//    credential meets it. The proof shows only the public rule, a nullifier and the payout address.
// 4. Disha's relayer sends the proof to the Proof Pays contract and pays the test-network gas.
//
// For the demo the payout goes to a wallet kept on this phone. In real use it would be a guardian's or the
// school's account (minors), on a real payment rail.

import {
  dayNumber, holderOf, meetsMilestone, newSecret, proveMilestone, readPublic, unpackLevels, verifyCredential,
  type Credential, type Milestone, type SkillProof, type SnarkJs,
} from "@disha/zk";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { apiFetch, API } from "./api";
import { db, type Student } from "./db";
import { syncEvents } from "./sync";

export { dayNumber, meetsMilestone, readPublic, unpackLevels, verifyCredential };
export type { Credential, SkillProof };

export interface FundedMilestone extends Milestone {
  name: string;
  funder: string;
  amount: number;
  budget: number;
  paid_count: number;
  open: boolean;
}

export interface PayConfig {
  enabled: boolean;
  issuer: [string, string] | null;
  subskill_order: string[];
  milestones: FundedMilestone[];
  chain_id?: number;
  rpc_url?: string;
  explorer?: string;
  proofpays?: Address;
  token?: Address;
  from_block?: number;
  error?: string;
}

const key = (kind: "secret" | "cred" | "wallet", id: string) => `zk.${kind}.${id}`;

export async function payConfig(): Promise<PayConfig | null> {
  try {
    const res = await fetch(`${API}/v2/pay/config`);
    return res.ok ? ((await res.json()) as PayConfig) : null;
  } catch {
    return null;
  }
}

async function secretFor(id: string): Promise<bigint> {
  const saved = (await db.meta.get(key("secret", id)))?.value;
  if (typeof saved === "string") return BigInt(saved);
  const s = newSecret();
  await db.meta.put({ key: key("secret", id), value: s.toString() });
  return s;
}

/** The demo payout address for this student (a key kept on this phone; test network only). */
export async function walletFor(id: string): Promise<Address> {
  let pk = (await db.meta.get(key("wallet", id)))?.value as `0x${string}` | undefined;
  if (!pk) {
    pk = generatePrivateKey();
    await db.meta.put({ key: key("wallet", id), value: pk });
  }
  return privateKeyToAddress(pk);
}

export async function savedCredential(id: string): Promise<Credential | null> {
  return ((await db.meta.get(key("cred", id)))?.value as Credential | undefined) ?? null;
}

/** Self-declared facts from her answers that go into the credential (only as bands and codes). */
function facts(s: Student) {
  const f = s.factAnswers;
  const income = typeof f.family_income_inr === "number" ? f.family_income_inr : null;
  return {
    family_income_inr: income,
    gender: typeof f.gender === "string" ? f.gender : null,
    category: typeof f.category === "string" ? f.category : null,
  };
}

export type CredentialError = "offline" | "consent" | "not_set_up" | "bad_signature" | "failed";

/** Asks Disha to sign a fresh credential from her evidence, checks the signature and keeps it on the phone. */
export async function requestCredential(s: Student, issuer: [string, string] | null):
  Promise<{ credential: Credential; levels: Record<string, number> } | { error: CredentialError }> {
  if (!navigator.onLine) return { error: "offline" };
  const secret = await secretFor(s.id);
  await syncEvents(); // the server signs what it knows, so send the latest evidence first
  let res: Response;
  try {
    res = await apiFetch("/v2/credential", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: s.id, holder: holderOf(secret).toString(), facts: facts(s) }),
    });
  } catch {
    return { error: "offline" };
  }
  if (res.status === 403) return { error: "consent" };
  if (res.status === 503) return { error: "not_set_up" };
  if (!res.ok) return { error: "failed" };
  const out = (await res.json()) as { credential: Credential; levels: Record<string, number> };
  const trusted = issuer ? ([BigInt(issuer[0]), BigInt(issuer[1])] as [bigint, bigint]) : undefined;
  if (!verifyCredential(out.credential, trusted) || out.credential.fields.holder !== holderOf(secret).toString()) {
    return { error: "bad_signature" };
  }
  await db.meta.put({ key: key("cred", s.id), value: out.credential });
  return out;
}

let snark: Promise<SnarkJs> | null = null;

/** Loads the snarkjs browser build (same origin, /zk/snarkjs.min.js) once. */
function loadSnark(): Promise<SnarkJs> {
  snark ??= new Promise<SnarkJs>((resolve, reject) => {
    const w = window as unknown as { snarkjs?: SnarkJs };
    if (w.snarkjs) return resolve(w.snarkjs);
    const el = document.createElement("script");
    el.src = "/zk/snarkjs.min.js";
    el.onload = () => (w.snarkjs ? resolve(w.snarkjs) : reject(new Error("snarkjs missing")));
    el.onerror = () => reject(new Error("snarkjs failed to load"));
    document.head.appendChild(el);
  });
  snark.catch(() => { snark = null; });
  return snark;
}

/** Makes the zero-knowledge proof on this phone, then checks it with the verification key (also on the phone). */
export async function prove(id: string, cred: Credential, m: Milestone, payout: Address):
  Promise<SkillProof & { verified: boolean; verifyMs: number }> {
  const snarkjs = await loadSnark();
  const secret = await secretFor(id);
  const today = dayNumber(Date.now());
  const p = await proveMilestone(snarkjs, "/zk/skill_proof.wasm", "/zk/skill_proof.zkey", cred, secret, m, BigInt(payout), today);
  const vkey = await (await fetch("/zk/verification_key.json")).json();
  const t0 = performance.now();
  const verified = await snarkjs.groth16.verify(vkey, p.publicSignals, p.proof);
  return { ...p, verified, verifyMs: Math.round(performance.now() - t0) };
}

export interface ClaimResult { ok: boolean; tx_hash?: string; explorer_url?: string | null; reason?: string; message?: string }

/** Sends the proof to Disha's relayer. `payout` may differ from the proof's own address (the cheat demo). */
export async function claim(milestoneId: number, p: SkillProof, payout: Address): Promise<ClaimResult> {
  const pub = readPublic(p.publicSignals);
  try {
    const res = await apiFetch("/v2/pay/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ milestone_id: milestoneId, payout, today: Number(pub.today),
        proof: { pi_a: p.proof.pi_a, pi_b: p.proof.pi_b, pi_c: p.proof.pi_c }, public_signals: p.publicSignals }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, ...out };
    const d = (out as { detail?: { reason?: string; message?: string } | string }).detail;
    return typeof d === "object" ? { ok: false, ...d } : { ok: false, message: String(d ?? res.status) };
  } catch {
    return { ok: false, message: "offline" };
  }
}

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** Demo Rupee balance of an address, read straight from the chain. */
export async function balanceOf(cfg: PayConfig, who: Address): Promise<number | null> {
  if (!cfg.rpc_url || !cfg.token) return null;
  try {
    const client = createPublicClient({ transport: http(cfg.rpc_url) });
    return Number(await client.readContract({ address: cfg.token, abi: ERC20, functionName: "balanceOf", args: [who] }));
  } catch {
    return null;
  }
}
