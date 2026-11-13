// Deterministic eligibility, a copy of apps/api/app/services/eligibility.py.
// JsonLogic rules per scheme. The LLM never decides eligibility.

import { apply, Evaluation, UNKNOWN } from "./jsonlogic.ts";
import { pyTruthy } from "./pymath.ts";
import type { Facts, KB, Lang } from "./types.ts";

// Next study stages a student could move into; used to show "eligible later" opportunities.
export const NEXT_STAGES: Record<string, string[]> = {
  school: ["iti", "diploma", "ug"], iti: ["diploma"], diploma: ["ug"], ug: ["pg"],
};
// Joining a stage implies at least this class passed.
const STAGE_MIN_PASSED: Record<string, number> = { iti: 10, diploma: 10, ug: 12, pg: 15 };

export type Status = "eligible" | "need_info" | "not_eligible";

export interface SchemeResult {
  scheme_id: string;
  name: Lang;
  type: string;
  benefit_en: string;
  required_documents: string[];
  apply_url: string;
  source_url: string;
  rule_updated: string | null;
  verified_on: string | null;
  status: Status;
  missing_facts: string[];
  eligible_if: { stage: string; course_type: string } | null;
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function check(kb: KB, schemeId: string, facts: Facts): { status: Status; missing_facts: string[] } {
  const ev = new Evaluation();
  const result = apply(kb.rules[schemeId].rule, facts, ev);
  if (result === UNKNOWN) return { status: "need_info", missing_facts: [...ev.missing].sort(byCodePoint) };
  return { status: pyTruthy(result) ? "eligible" : "not_eligible", missing_facts: [] };
}

/** The student's facts as they would be in their first year of a new stage. */
export function joined(facts: Facts, stage: string, courseType: string): Facts {
  const hypo: Facts = {};
  for (const [k, v] of Object.entries(facts)) {
    if (k !== "current_class" && k !== "final_year" && k !== "lateral_entry") hypo[k] = v;
  }
  Object.assign(hypo, { stage, course_type: courseType, year_of_study: 1 });
  const passed = facts.passed_class;
  hypo.passed_class = Math.max(typeof passed === "number" ? passed : 0, STAGE_MIN_PASSED[stage]);
  return hypo;
}

export function evaluateAll(kb: KB, facts: Facts): SchemeResult[] {
  const results: SchemeResult[] = [];
  for (const [sid, scheme] of Object.entries(kb.schemes)) {
    if (!(sid in kb.rules)) continue;
    const res = check(kb, sid, facts);
    let later: SchemeResult["eligible_if"] = null;
    if (res.status !== "eligible") {
      outer: for (const stage of NEXT_STAGES[String(facts.stage ?? "")] ?? []) {
        for (const courseType of ["technical", "general"]) {
          if (check(kb, sid, joined(facts, stage, courseType)).status === "eligible") {
            later = { stage, course_type: courseType };
            break outer;
          }
        }
      }
    }
    results.push({
      scheme_id: sid,
      name: scheme.name,
      type: scheme.type,
      benefit_en: scheme.benefit_en,
      required_documents: scheme.required_documents,
      apply_url: scheme.apply_url,
      source_url: scheme.source_url,
      rule_updated: kb.rules[sid].updated ?? null,
      verified_on: scheme.verified_on ?? null,
      ...res,
      eligible_if: later,
    });
  }
  const order: Record<Status, number> = { eligible: 0, need_info: 1, not_eligible: 2 };
  results.sort((a, b) =>
    order[a.status] - order[b.status] || Number(a.eligible_if === null) - Number(b.eligible_if === null));
  return results;
}
