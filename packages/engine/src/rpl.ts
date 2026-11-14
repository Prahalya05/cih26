// RPL certification as an opportunity: once she works at level 4 (paid work, or teaches it) in a sub-skill a
// national qualification assesses, she can apply to be certified under PMKVY RPL without a training course.

import type { KB } from "./types.ts";
import type { Rpl } from "./types.ts";

/** PMKVY 4.0 RPL is for ages 18 to 59 (NSDC FAQ). */
export const RPL_MIN_AGE = 18;
export const RPL_LEVEL = 4;

export interface RplStatus {
  occupation: string;
  rpl: Rpl;
  /** eligible: can apply now; at18: has the skill but must wait until 18 */
  status: "eligible" | "at18";
  subskills: string[];
}

/** RPL opportunities for one student: careers whose qualification covers a sub-skill she has at level 4. */
export function rplOpportunities(kb: KB, units: Record<string, { level: number }>, minor: boolean): RplStatus[] {
  const out: RplStatus[] = [];
  for (const [id, occ] of Object.entries(kb.occupations)) {
    if (!occ.rpl) continue;
    const strong = occ.rpl.subskills.filter((u) => (units[u]?.level ?? 0) >= RPL_LEVEL);
    if (strong.length === 0) continue;
    out.push({ occupation: id, rpl: occ.rpl, status: minor ? "at18" : "eligible", subskills: strong });
  }
  return out;
}
