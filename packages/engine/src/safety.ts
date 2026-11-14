// Child-safety rules (Step 11.3). Keep in step with apps/api/app/services/safety.py.

import type { Graph } from "./graph.ts";
import type { Rubric } from "./tracing.ts";

/**
 * True unless she is certainly 18 or older. Only the birth year is known, so someone who turns 18
 * later this year still counts as under 18; an unknown birth year also counts as under 18.
 */
export function isMinor(birthYear: number | null | undefined, now: Date = new Date()): boolean {
  if (!birthYear) return true;
  return now.getFullYear() - birthYear < 19;
}

/** A sub-skill an under-18 must never be given a work sample for. */
export function isHazardousForMinor(g: Graph, subskillId: string | undefined): boolean {
  return !!subskillId && !!g.subskills[subskillId]?.hazardous_under_18;
}

/**
 * The work sample she may be given: for an under-18, checklist items on hazardous sub-skills are removed.
 * Returns null when nothing safe is left, so the sample is not offered at all.
 */
export function safeRubric<R extends Rubric>(g: Graph, rubric: R, minor: boolean): R | null {
  if (!minor) return rubric;
  const criteria = rubric.criteria.filter((c) => !isHazardousForMinor(g, c.subskill));
  return criteria.length > 0 ? { ...rubric, criteria } : null;
}
