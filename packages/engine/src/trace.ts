// Decision trace: one record per decision the system makes, saying whether a fixed rule or the AI made it.
// The app shows these live in the X-ray panel and as a "Why?" flowchart. Building a record never changes a result.
//
//   RULE        a deterministic rule or formula from this engine decided (same input, same answer, testable)
//   AI          the AI produced something open-ended (a transcript, a suggestion) that no rule could
//   AI_CHECKED  the AI suggested, then a rule checked it (kept what passed, dropped the rest) before it was used

import { describeLeaf, type Leaf } from "./jsonlogic.ts";
import type { CareerBreakdown } from "./fitreach.ts";
import { FRW_WEIGHTS, REACH_PARTS, WORTH_PARTS } from "./fitreach.ts";

export type DecisionSource = "RULE" | "AI" | "AI_CHECKED";

export interface AiInfo {
  model: string;
  latency_ms?: number;
  /** what the AI returned that passed the rule check */
  kept?: string[];
  /** what the rule check removed, with the reason */
  dropped?: { value: string; reason: string }[];
  /** set when the AI could not be used and a rule-based fallback ran instead */
  fallback?: string;
  /** answered from the demo cache instead of a live call */
  cached?: boolean;
}

export interface Decision {
  id: string;
  at: number;
  /** pipeline step: onboarding, interests, skills, careers, schemes, opportunities, safety ... */
  step: string;
  source: DecisionSource;
  /** registry id of the rule or formula, or the AI task id */
  ref: string;
  /** short title, e.g. "Electrician (ITI): score 0.68" */
  title: string;
  /** what the decision is about, e.g. "career:occ_electrician", so a result can find its own decisions */
  subject?: string;
  inputs?: Record<string, unknown>;
  output: string;
  /** the reasoning, one line per step, with real numbers */
  why: string[];
  ai?: AiInfo;
  /** dedupe key used by the app so the same decision is not recorded twice */
  key?: string;
}

let counter = 0;
export const decisionId = () => `d${Date.now().toString(36)}${(counter++).toString(36)}`;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n2 = (x: number) => x.toFixed(2);

/** A career's score as a decision, with the formula and its real values. */
export function careerDecision(b: CareerBreakdown, name: string, rank?: number): Decision {
  const why = [
    `score = ${FRW_WEIGHTS.fit}×Fit + ${FRW_WEIGHTS.reach}×Reach + ${FRW_WEIGHTS.worth}×Worth`,
    `      = ${FRW_WEIGHTS.fit}×${n2(b.fit)} + ${FRW_WEIGHTS.reach}×${n2(b.reach.total)} + ${FRW_WEIGHTS.worth}×${n2(b.worth.total)} = ${n2(b.total)}`,
    `Fit ${n2(b.fit)}: ${b.needs.filter((x) => x.met).length} of ${b.needs.length} needed sub-skills met (60%+ chance at the needed level)`,
    `Reach ${n2(b.reach.total)} = ${REACH_PARTS.aptitude}×aptitude ${n2(b.reach.aptitude)} + ${REACH_PARTS.closeness}×closeness ${n2(b.reach.closeness)} + ${REACH_PARTS.education}×education ${n2(b.reach.education)}${b.reach.edu_gap ? ` (${b.reach.edu_gap} level(s) of study to go)` : ""}`,
    `Worth ${n2(b.worth.total)} = ${WORTH_PARTS.interest}×interest ${n2(b.worth.interest)} + ${WORTH_PARTS.demand}×local demand ${n2(b.worth.demand)}`,
  ];
  return {
    id: decisionId(), at: Date.now(), step: "careers", source: "RULE", ref: "formula.fitreach",
    title: `${name}: score ${n2(b.total)}${rank ? ` (#${rank})` : ""}`, subject: `career:${b.occupation_id}`,
    inputs: { needs: b.needs.length }, output: n2(b.total), why,
  };
}

/** A scheme check as a decision: every condition of the rule with ✓, ✗ or ? (fact not given yet). */
export function schemeDecision(x: { scheme_id: string; status: string; missing_facts: string[]; leaves: Leaf[]; notes?: string | null },
  name: string): Decision {
  const label = { eligible: "Eligible", need_info: "Need more information", not_eligible: "Not eligible" }[x.status] ?? x.status;
  const why = x.leaves.map(describeLeaf);
  if (x.missing_facts.length) why.push(`Missing facts: ${x.missing_facts.join(", ")}`);
  if (x.notes) why.push(`Rule note: ${x.notes}`);
  return {
    id: decisionId(), at: Date.now(), step: "schemes", source: "RULE", ref: `rule.${x.scheme_id}`,
    title: `${name}: ${label}`, subject: `scheme:${x.scheme_id}`, output: label, why,
  };
}

export const fmtPct = pct;
