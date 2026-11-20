// Opportunity readiness: is she ready to apply for an internship, apprenticeship, job, mentorship or training?
// A fixed rule, never the AI:
//
//   1. Hard checks: age range, minimum education, and the programme's eligibility rule (JsonLogic) if it has one.
//      Any definite "no" -> Later.
//   2. Skill share: of the sub-skills the listing needs, how many she meets (60%+ chance at the needed level,
//      the same "met" test as career matching). No evidence counts half, like career matching.
//   3. share >= 80% -> Ready;  share >= 50% -> Almost (shows the gap to close);  else Later.

import { check } from "./eligibility.ts";
import { MET, UNKNOWN_LEVELS } from "./fitreach.ts";
import { EDUCATION_ORDER } from "./kb.ts";
import type { Facts, KB, Lang } from "./types.ts";

export type OpportunityKind = "internship" | "apprenticeship" | "job" | "mentorship" | "training";

export interface Opportunity {
  id: string;
  kind: OpportunityKind;
  title: Lang;
  org: string;
  org_type: "company" | "msme" | "ngo" | "govt" | "mentor";
  district?: string;
  state?: string;
  mode?: "onsite" | "remote" | "hybrid";
  stipend_inr_month?: number;
  duration_months?: number;
  /** sub-skill or skill ids with the level needed */
  needs: { id: string; level: number }[];
  /** a rule id in packages/kb/rules (programme eligibility), checked like a scheme */
  rule?: string;
  min_age?: number;
  max_age?: number;
  min_education?: string;
  /** careers this opens a door to */
  careers?: string[];
  closes?: string | null;
  seats?: number;
  apply: { mode: "in_app" | "external"; url?: string };
  description_en?: string;
  /** true for illustrative listings (not a real vacancy) */
  sample?: boolean;
  source_url?: string;
  verified_on?: string | null;
}

export const READY_SHARE = 0.8;
export const ALMOST_SHARE = 0.5;
const UNKNOWN_CREDIT = 0.5;

export type ReadinessStatus = "ready" | "almost" | "later";

export interface OppReadiness {
  opportunity_id: string;
  status: ReadinessStatus;
  skill_share: number;
  met: string[];
  gaps: string[];
  /** each hard check: ok true/false, or null when the fact is not known yet */
  checks: { name: string; ok: boolean | null; detail: string }[];
  why: string[];
}

function atLeast(p: number[], level: number): number {
  let s = 0;
  for (let L = level - 1; L < 4; L++) s += p[L];
  return s;
}

export function opportunityReadiness(kb: KB, opp: Opportunity, input: { levels: Record<string, number[]>; facts: Facts; age?: number; education?: string }): OppReadiness {
  const checks: OppReadiness["checks"] = [];
  const age = input.age ?? (typeof input.facts.age === "number" ? input.facts.age : undefined);
  if (opp.min_age !== undefined || opp.max_age !== undefined) {
    const lo = opp.min_age ?? 0, hi = opp.max_age ?? 200;
    checks.push({ name: "age", ok: age === undefined ? null : age >= lo && age <= hi,
      detail: `age ${age ?? "?"} in ${lo}${opp.max_age !== undefined ? `–${hi}` : "+"}` });
  }
  if (opp.min_education) {
    const have = EDUCATION_ORDER[input.education ?? ""];
    const need = EDUCATION_ORDER[opp.min_education] ?? 0;
    checks.push({ name: "education", ok: have === undefined ? null : have >= need,
      detail: `education ${input.education ?? "?"} ≥ ${opp.min_education}` });
  }
  if (opp.rule && kb.rules[opp.rule]) {
    const r = check(kb, opp.rule, input.facts);
    checks.push({ name: "rule", ok: r.status === "eligible" ? true : r.status === "not_eligible" ? false : null,
      detail: `programme rule ${opp.rule}: ${r.status}${r.missing_facts.length ? ` (missing ${r.missing_facts.join(", ")})` : ""}` });
  }

  const met: string[] = [];
  const gaps: string[] = [];
  for (const n of opp.needs) {
    const known = input.levels[n.id];
    const ok = atLeast(known ?? UNKNOWN_LEVELS, n.level) * (known ? 1 : UNKNOWN_CREDIT);
    (ok >= MET ? met : gaps).push(n.id);
  }
  const share = opp.needs.length ? met.length / opp.needs.length : 1;
  const blocked = checks.some((c) => c.ok === false);
  const status: ReadinessStatus = blocked ? "later" : share >= READY_SHARE ? "ready" : share >= ALMOST_SHARE ? "almost" : "later";

  const why = [
    ...checks.map((c) => `${c.detail} ${c.ok === null ? "?" : c.ok ? "✓" : "✗"}`),
    `skills met: ${met.length} of ${opp.needs.length} = ${Math.round(share * 100)}% (Ready ≥ ${READY_SHARE * 100}%, Almost ≥ ${ALMOST_SHARE * 100}%)`,
    blocked ? "a hard check failed → Later" : `→ ${status === "ready" ? "Ready" : status === "almost" ? "Almost" : "Later"}`,
  ];
  if (gaps.length && status !== "later") why.push(`to close: ${gaps.join(", ")}`);
  return { opportunity_id: opp.id, status, skill_share: Math.round(share * 1000) / 1000, met, gaps, checks, why };
}

/** All listings with her readiness, Ready first, then Almost, then Later (stable within each group). */
export function rankOpportunities(kb: KB, opps: Opportunity[], input: Parameters<typeof opportunityReadiness>[2]) {
  const order: Record<ReadinessStatus, number> = { ready: 0, almost: 1, later: 2 };
  return opps.map((opp) => ({ opp, r: opportunityReadiness(kb, opp, input) }))
    .sort((a, b) => order[a.r.status] - order[b.r.status] || b.r.skill_share - a.r.skill_share);
}
