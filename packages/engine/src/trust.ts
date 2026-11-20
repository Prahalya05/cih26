// Trust rules: who confirms what, and when money or an application may go ahead. All fixed rules, never the AI.
//
//   rule.override      a teacher overrides a skill level (with a reason). Lowering always applies; raising applies to
//                      what she sees but can never by itself unlock money (rule.paycheck needs performance evidence).
//   rule.identity      is the person in the task video the student? Liveness challenge + on-phone face match.
//   rule.autoconfirm   may the system confirm an AI-scored video itself, or must a teacher look?
//   rule.paycheck      may a donor's money go to this student? Skill proven + need verified + consent + identity.
//   rule.apply_docs    may she send an application? Required documents verified + resume ready + not "Later".
//
// Keep the thresholds here: registry.ts reads them, so the "How Disha decides" screen can never drift from the code.

import type { EvidenceEvent } from "./events.ts";
import type { Profile, UnitState } from "./tracing.ts";

// ---------- teacher override ----------

export const OVERRIDE_RULE = { minReasonChars: 8 } as const;

export interface Override {
  unit: string;
  from: number;
  to: number;
  reason: string;
  by?: string;
  at: number;
  /** raised above the computed level: shown to her, but does not count as proof for payouts */
  up: boolean;
}

export interface OverriddenUnit extends UnitState {
  override?: Override;
}

export function isOverrideEvent(e: EvidenceEvent): boolean {
  const p = e.payload ?? {};
  return e.kind === "rating" && !e.refers_to && p.override === true;
}

/**
 * Applies the latest teacher override per sub-skill on top of the computed profile.
 * The computed level stays in `override.from`, so the change is always visible and reversible.
 */
export function applyOverrides(profile: Profile, events: EvidenceEvent[]): Profile & { units: Record<string, OverriddenUnit> } {
  const latest = new Map<string, EvidenceEvent>();
  for (const e of [...events].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))) {
    if (!isOverrideEvent(e)) continue;
    const unit = e.subskill_id || e.skill_id;
    if (unit) latest.set(unit, e);
  }
  const units: Record<string, OverriddenUnit> = { ...profile.units };
  for (const [unit, e] of latest) {
    const base = units[unit];
    const to = Number(e.payload.level);
    if (!base || !(to >= 1 && to <= 4)) continue;
    const from = base.level;
    if (from === to) continue;
    const up = to > from;
    units[unit] = {
      ...base,
      level: to,
      // Raising: shown, but "strong" still needs her own performance evidence at that level.
      strong: up ? base.strong && to <= from : base.strong && to >= 3,
      override: { unit, from, to, reason: String(e.payload.reason ?? ""), by: e.rater_id, at: e.created_at, up },
    };
  }
  return { ...profile, units };
}

// ---------- identity: is it really her in the video? ----------

export const IDENTITY_RULE = {
  /** face-descriptor distance (128-d, Euclidean) at or below this = same person */
  maxFaceDistance: 0.5,
  /** share of sampled frames that must contain a face that matches */
  minMatchedShare: 0.6,
  /** the liveness challenge (show N fingers in the first seconds) must be passed */
  livenessRequired: true,
} as const;

export interface IdentityInput {
  /** a face was enrolled for her (a selfie, on the phone only) */
  enrolled: boolean;
  /** best (smallest) distance per sampled frame that had a face; frames with no face are not listed */
  distances: number[];
  /** frames sampled in total */
  sampled: number;
  liveness: { asked: number; seen: number | null } | null;
}

export interface IdentityResult {
  status: "verified" | "mismatch" | "unknown";
  matched_share: number;
  best_distance: number | null;
  liveness_ok: boolean | null;
  why: string[];
}

export function identityCheck(x: IdentityInput): IdentityResult {
  const why: string[] = [];
  const live = x.liveness ? x.liveness.seen === x.liveness.asked : null;
  if (x.liveness) why.push(`liveness: asked to show ${x.liveness.asked} finger(s), saw ${x.liveness.seen ?? "none"} ${live ? "✓" : "✗"}`);
  else why.push("liveness: not done ?");
  if (!x.enrolled) {
    why.push("no face enrolled for her yet → cannot compare ?");
    return { status: "unknown", matched_share: 0, best_distance: null, liveness_ok: live, why };
  }
  const matched = x.distances.filter((d) => d <= IDENTITY_RULE.maxFaceDistance).length;
  const share = x.sampled ? matched / x.sampled : 0;
  const best = x.distances.length ? Math.min(...x.distances) : null;
  why.push(`face match: ${matched} of ${x.sampled} frames within distance ${IDENTITY_RULE.maxFaceDistance} = ${Math.round(share * 100)}% (need ≥ ${IDENTITY_RULE.minMatchedShare * 100}%)`);
  if (best !== null) why.push(`closest distance ${best.toFixed(2)}`);
  let status: IdentityResult["status"];
  if (x.sampled === 0 || x.distances.length === 0) status = "unknown";
  else if (share >= IDENTITY_RULE.minMatchedShare && (live !== false || !IDENTITY_RULE.livenessRequired)) status = live === null && IDENTITY_RULE.livenessRequired ? "unknown" : "verified";
  else status = "mismatch";
  why.push(`→ ${status}`);
  return { status, matched_share: Math.round(share * 1000) / 1000, best_distance: best, liveness_ok: live, why };
}

// ---------- auto-confirm: can the system confirm the AI's score itself? ----------

export const AUTOCONFIRM_RULE = {
  /** the AI rater must agree with teachers at least this well (Cohen's kappa) */
  minKappa: 0.6,
  /** at most this share of checklist items may be "cannot see" */
  maxCannotSee: 0.2,
  /** this share of auto-confirmable samples still goes to a teacher at random (spot checks) */
  auditShare: 0.1,
} as const;

export interface AutoConfirmInput {
  identity: IdentityResult["status"];
  integrity_flags: string[];
  safety_flags: number;
  cannot_see: number;
  criteria: number;
  ai_kappa: number | null;
  /** 0-1, deterministic from the sample id so the audit pick is reproducible */
  audit_draw: number;
  minor_hazard?: boolean;
}

export interface AutoConfirmResult {
  decision: "auto_confirm" | "teacher";
  why: string[];
}

export function autoConfirm(x: AutoConfirmInput): AutoConfirmResult {
  const checks: [string, boolean][] = [
    [`identity verified (${x.identity})`, x.identity === "verified"],
    [`no integrity flags (${x.integrity_flags.join(", ") || "none"})`, x.integrity_flags.length === 0],
    [`no safety notes (${x.safety_flags})`, x.safety_flags === 0],
    [`"cannot see" ${x.cannot_see}/${x.criteria} ≤ ${AUTOCONFIRM_RULE.maxCannotSee * 100}%`, x.criteria > 0 && x.cannot_see / x.criteria <= AUTOCONFIRM_RULE.maxCannotSee],
    [`AI agreement with teachers κ ${x.ai_kappa === null ? "unknown" : x.ai_kappa.toFixed(2)} ≥ ${AUTOCONFIRM_RULE.minKappa}`, x.ai_kappa !== null && x.ai_kappa >= AUTOCONFIRM_RULE.minKappa],
    [`not a hazardous task for a minor`, !x.minor_hazard],
  ];
  const why = checks.map(([t, ok]) => `${t} ${ok ? "✓" : "✗"}`);
  const allOk = checks.every(([, ok]) => ok);
  const audited = x.audit_draw < AUTOCONFIRM_RULE.auditShare;
  if (allOk && audited) why.push(`random spot check (draw ${x.audit_draw.toFixed(2)} < ${AUTOCONFIRM_RULE.auditShare}) → teacher`);
  const decision = allOk && !audited ? "auto_confirm" : "teacher";
  why.push(decision === "auto_confirm" ? "→ confirmed by the system; the teacher can still undo it" : "→ goes to the teacher's queue");
  return { decision, why };
}

/** A stable 0-1 number from an id (FNV-1a), for reproducible random spot checks. */
export function drawFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h / 2 ** 32;
}

// ---------- donor pay check ----------

export const PAYCHECK_RULE = {
  /** family income per year at or below this counts as need (same line as most state scholarships) */
  maxIncomeInr: 250_000,
  /** documents a teacher must have seen for need to count as verified (any one of them) */
  needDocs: ["income_certificate", "ration_card_bpl", "scholarship_letter"],
} as const;

export interface PayCheckInput {
  skill: { unit: string; level: number; needLevel: number; performance: boolean; overriddenUp: boolean };
  income_inr: number | null;
  /** document kinds a teacher marked as seen and genuine */
  verified_docs: string[];
  consent_share: boolean;
  identity: IdentityResult["status"] | "not_needed";
  already_paid: boolean;
}

export interface PayCheckResult {
  ok: boolean;
  checks: { name: "skill" | "need" | "consent" | "identity" | "once"; ok: boolean | null; detail: string }[];
  why: string[];
}

export function payCheck(x: PayCheckInput): PayCheckResult {
  const s = x.skill;
  const skillOk = s.level >= s.needLevel && s.performance && !s.overriddenUp;
  const docOk = x.verified_docs.some((d) => (PAYCHECK_RULE.needDocs as readonly string[]).includes(d));
  const incomeOk = x.income_inr === null ? null : x.income_inr <= PAYCHECK_RULE.maxIncomeInr;
  const checks: PayCheckResult["checks"] = [
    { name: "skill", ok: skillOk, detail: `level ${s.level} ≥ ${s.needLevel}, shown by her own work${s.performance ? "" : " (no performance evidence)"}${s.overriddenUp ? " (raised by override: not proof)" : ""}` },
    // Need: income above the line → no; a teacher-seen document → yes; otherwise not known yet.
    { name: "need", ok: incomeOk === false ? false : docOk ? true : null,
      detail: `income ₹${x.income_inr?.toLocaleString("en-IN") ?? "?"} ≤ ₹${PAYCHECK_RULE.maxIncomeInr.toLocaleString("en-IN")} and a teacher saw one of: ${PAYCHECK_RULE.needDocs.join(", ")} (${docOk ? "seen" : "not yet"})` },
    { name: "consent", ok: x.consent_share, detail: "her family agreed to share her proof with funders" },
    { name: "identity", ok: x.identity === "not_needed" ? true : x.identity === "verified" ? true : x.identity === "mismatch" ? false : null,
      detail: `the person in her task video is her (${x.identity})` },
    { name: "once", ok: !x.already_paid, detail: "not already paid for this milestone" },
  ];
  const ok = checks.every((c) => c.ok === true);
  const why = [...checks.map((c) => `${c.name}: ${c.detail} ${c.ok === null ? "?" : c.ok ? "✓" : "✗"}`), ok ? "→ may be paid" : "→ hold: not every check passed"];
  return { ok, checks, why };
}

// ---------- application documents ----------

export const DOC_KINDS = ["resume", "id_proof", "marksheet", "income_certificate", "ration_card_bpl", "community_certificate", "bank_passbook", "scholarship_letter", "photo"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export type DocStatus = "missing" | "uploaded" | "verified" | "rejected";

/** Documents an application needs, by kind of listing. Programme rules can add more. */
export const APPLY_DOCS: Record<string, DocKind[]> = {
  internship: ["resume", "id_proof"],
  apprenticeship: ["resume", "id_proof", "marksheet", "bank_passbook"],
  job: ["resume", "id_proof"],
  mentorship: ["resume"],
  training: ["id_proof"],
};

export interface ApplyCheckResult {
  ok: boolean;
  docs: { kind: DocKind; status: DocStatus }[];
  why: string[];
}

export function applyCheck(kind: string, readiness: "ready" | "almost" | "later", docs: Partial<Record<DocKind, DocStatus>>, extra: DocKind[] = []): ApplyCheckResult {
  const need = [...new Set([...(APPLY_DOCS[kind] ?? ["resume"]), ...extra])];
  const list = need.map((k) => ({ kind: k, status: docs[k] ?? "missing" as DocStatus }));
  // A resume made by Disha from her verified record counts as verified; uploads need a teacher (or the AI check) to pass.
  const docsOk = list.every((d) => d.status === "verified" || (d.status === "uploaded" && d.kind === "photo"));
  const readyOk = readiness !== "later";
  const why = [
    ...list.map((d) => `${d.kind}: ${d.status} ${d.status === "verified" ? "✓" : d.status === "uploaded" ? "… waiting for check" : "✗"}`),
    `readiness ${readiness} ${readyOk ? "✓" : "✗ (Later: build the skills first)"}`,
    docsOk && readyOk ? "→ can apply" : "→ not yet",
  ];
  return { ok: docsOk && readyOk, docs: list, why };
}
