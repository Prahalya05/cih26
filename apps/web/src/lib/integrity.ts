// Fair-test check: the flag names and how a teacher sees them. Pure code (no camera, no MediaPipe), so the teacher
// screen can import it without pulling in the vision runtime. The live detection is in lib/proctor.ts.

import type { EvidenceEvent } from "@disha/engine";

/** Things the check can notice while a question is on screen. */
export type Flag =
  | "no_face"      // no face in the front camera for a few seconds
  | "multi_face"   // two or more faces, or two or more people
  | "look_away"    // head turned well to one side for a few seconds
  | "phone"        // a second phone seen by the camera
  | "notes"        // a book or notes seen by the camera
  | "dark"         // camera covered or pointing at nothing
  | "camera_lost"  // camera stopped during the test
  | "tab_away"     // she left Disha (another app or tab) mid-question
  | "paste";       // an answer was pasted in

export const FLAGS: Flag[] = ["multi_face", "phone", "tab_away", "paste", "notes", "look_away", "no_face", "dark", "camera_lost"];

/** Flags that suggest outside help, not just a shaky camera. Shown in red to the teacher. */
export const SERIOUS: ReadonlySet<Flag> = new Set<Flag>(["multi_face", "phone", "tab_away", "paste", "notes"]);

/** How the test was checked: with the camera, or only browser signals (leaving the app, pasting). */
export type CheckMode = "camera" | "browser";

export interface IntegritySummary {
  subskill: string;
  answers: number;
  flagged: number;
  mode: CheckMode | "none";
  counts: Partial<Record<Flag, number>>;
  serious: boolean;
}

/** Per sub-skill summary of a student's test answers, newest test first. */
export function integrityOf(events: Pick<EvidenceEvent, "kind" | "subskill_id" | "payload" | "created_at">[]): IntegritySummary[] {
  const out = new Map<string, IntegritySummary & { last: number }>();
  for (const e of events) {
    if (e.kind !== "item_response" || !e.subskill_id) continue;
    const p = e.payload as { integrity?: unknown; checked?: unknown };
    const cur = out.get(e.subskill_id) ?? { subskill: e.subskill_id, answers: 0, flagged: 0, mode: "none", counts: {}, serious: false, last: 0 };
    cur.answers++;
    cur.last = Math.max(cur.last, e.created_at);
    if (p.checked === "camera") cur.mode = "camera";
    else if (p.checked === "browser" && cur.mode === "none") cur.mode = "browser";
    const flags = Array.isArray(p.integrity) ? (p.integrity as Flag[]).filter((f) => FLAGS.includes(f)) : [];
    if (flags.length) cur.flagged++;
    for (const f of flags) {
      cur.counts[f] = (cur.counts[f] ?? 0) + 1;
      if (SERIOUS.has(f)) cur.serious = true;
    }
    out.set(e.subskill_id, cur);
  }
  return [...out.values()].sort((a, b) => b.last - a.last).map(({ last: _last, ...s }) => s);
}
