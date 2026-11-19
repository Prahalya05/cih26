// The Disha skill credential: 11 numbers the server signs, and the private inputs the student's phone
// feeds to the circuit (circuits/skill_proof.circom) to prove a milestone without showing them.
// Keep the field order in step with apps/api/app/zk/credential.py and the circuit.

import { verifySignature, type Point, type Signature } from "./babyjub.ts";
import { P, poseidon } from "./poseidon.ts";

export const CREDENTIAL_VERSION = 1;
export const MAX_SUBSKILLS = 32;
export const UNKNOWN_INCOME = 15;

/** Family income bands, matching the app's income question (rupees per year). */
export const INCOME_BANDS = [
  { band: 0, max: 100_000, en: "Under ₹1 lakh" },
  { band: 1, max: 250_000, en: "₹1 – 2.5 lakh" },
  { band: 2, max: 350_000, en: "₹2.5 – 3.5 lakh" },
  { band: 3, max: 800_000, en: "₹3.5 – 8 lakh" },
  { band: 4, max: Infinity, en: "Over ₹8 lakh" },
];
export const GENDERS: Record<string, number> = { female: 1, male: 2, other: 3 };
export const CATEGORIES: Record<string, number> = { sc: 1, st: 2, mbc: 3, bc: 4, general: 5 };

export interface CredentialFields {
  levels: bigint;      // 32 sub-skills x 2 bits, each (level - 1), index = position in subskillOrder
  orders: number;      // buyer-confirmed paid orders
  earned_inr: number;  // total of those orders
  income_band: number; // 0-4, 15 = not given (self-declared)
  gender: number;      // 0 not given, 1 female, 2 male, 3 other (self-declared)
  category: number;    // 0 not given, 1 SC, 2 ST, 3 MBC, 4 BC, 5 general (self-declared)
  birth_year: number;
  issued_day: number;  // days since 1 January 1970 (UTC)
  expires_day: number;
  holder: bigint;      // Poseidon(student secret): only her phone knows the secret
  serial: bigint;      // random, so two credentials with the same facts differ
}

export interface Credential {
  version: number;
  fields: Record<keyof CredentialFields, string>; // decimal strings (JSON-safe)
  subskill_order: string[];
  signature: { R8: [string, string]; S: string };
  issuer: [string, string];
}

export const FIELD_ORDER: (keyof CredentialFields)[] = [
  "levels", "orders", "earned_inr", "income_band", "gender", "category", "birth_year",
  "issued_day", "expires_day", "holder", "serial",
];

export const dayNumber = (ms: number): number => Math.floor(ms / 86_400_000);

export function incomeBand(income?: number | null): number {
  if (typeof income !== "number" || !Number.isFinite(income)) return UNKNOWN_INCOME;
  return INCOME_BANDS.find((b) => income < b.max)!.band;
}

/** Packs levels (1-4) into one number: 2 bits per sub-skill, in subskillOrder. Missing = level 1. */
export function packLevels(levels: Record<string, number>, subskillOrder: string[]): bigint {
  let packed = 0n;
  subskillOrder.slice(0, MAX_SUBSKILLS).forEach((id, i) => {
    const level = Math.min(4, Math.max(1, Math.round(levels[id] ?? 1)));
    packed |= BigInt(level - 1) << BigInt(2 * i);
  });
  return packed;
}

export function unpackLevels(packed: bigint, subskillOrder: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  subskillOrder.slice(0, MAX_SUBSKILLS).forEach((id, i) => { out[id] = Number((packed >> BigInt(2 * i)) & 3n) + 1; });
  return out;
}

const big = (c: Credential): bigint[] => FIELD_ORDER.map((k) => BigInt(c.fields[k]));

export function credentialHash(c: Credential): bigint {
  return poseidon(big(c));
}

export function signatureOf(c: Credential): Signature {
  return { R8: [BigInt(c.signature.R8[0]), BigInt(c.signature.R8[1])], S: BigInt(c.signature.S) };
}

export const issuerOf = (c: Credential): Point => [BigInt(c.issuer[0]), BigInt(c.issuer[1])];

/** Checks the issuer's signature over the credential (works offline). */
export function verifyCredential(c: Credential, trustedIssuer?: Point): boolean {
  const issuer = issuerOf(c);
  if (trustedIssuer && (issuer[0] !== trustedIssuer[0] || issuer[1] !== trustedIssuer[1])) return false;
  return verifySignature(credentialHash(c), signatureOf(c), issuer);
}

/** A random secret in the field, kept on the phone; the credential only holds Poseidon(secret). */
export function newSecret(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x % P;
}

export const holderOf = (secret: bigint): bigint => poseidon([secret]);
export const nullifierOf = (secret: bigint, milestoneId: bigint | number): bigint => poseidon([secret, BigInt(milestoneId)]);

/** What a funder asks for. Public: everyone, including the contract, sees these numbers. */
export interface Milestone {
  id: number;
  subskill_index: number;
  min_level: number;        // 1-4
  min_orders: number;
  max_income_band: number;  // 0-4 (15 would allow "not given")
  required_gender: number;  // 0 = anyone
}

/** Everything the circuit needs. Private values never leave the phone; only the proof does. */
export function circuitInputs(c: Credential, secret: bigint, m: Milestone, payout: bigint, today: number) {
  const f = c.fields;
  const sig = signatureOf(c);
  const issuer = issuerOf(c);
  return {
    // public
    issuerAx: issuer[0].toString(), issuerAy: issuer[1].toString(),
    milestoneId: String(m.id), subskillIndex: String(m.subskill_index), minLevel: String(m.min_level),
    minOrders: String(m.min_orders), maxIncomeBand: String(m.max_income_band), requiredGender: String(m.required_gender),
    today: String(today), payout: payout.toString(),
    // private
    levels: f.levels, orders: f.orders, earnedInr: f.earned_inr, incomeBand: f.income_band, gender: f.gender,
    category: f.category, birthYear: f.birth_year, issuedDay: f.issued_day, expiresDay: f.expires_day,
    serial: f.serial, secret: secret.toString(),
    R8x: sig.R8[0].toString(), R8y: sig.R8[1].toString(), S: sig.S.toString(),
  };
}

/** Plain-language check of the same rules the circuit enforces, so the app can say "not yet" before proving. */
export function meetsMilestone(c: Credential, m: Milestone, today: number): { ok: boolean; reasons: string[] } {
  const f = c.fields;
  const level = Number((BigInt(f.levels) >> BigInt(2 * m.subskill_index)) & 3n) + 1;
  const reasons: string[] = [];
  if (level < m.min_level) reasons.push(`level ${level} of ${m.min_level}`);
  if (Number(f.orders) < m.min_orders) reasons.push(`${f.orders} of ${m.min_orders} confirmed orders`);
  if (Number(f.income_band) > m.max_income_band) reasons.push("family income band");
  if (m.required_gender !== 0 && Number(f.gender) !== m.required_gender) reasons.push("programme is for another group");
  if (today > Number(f.expires_day)) reasons.push("credential expired");
  if (today < Number(f.issued_day)) reasons.push("credential not yet valid");
  return { ok: reasons.length === 0, reasons };
}
