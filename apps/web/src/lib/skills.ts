// A student's skill levels on the phone: rebuilt from her events with the engine, cached in skillState.

import { foldEvents, type ItemParams, type Profile, type Rubric } from "@disha/engine";
import { db } from "./db";
import { kb } from "./kb";

const itemModules = import.meta.glob<{ default: (ItemParams & { subskill: string })[] }>(
  "../../../../packages/kb/items/*.json", { eager: true });
const rubricModules = import.meta.glob<{ default: Rubric }>("../../../../packages/kb/rubrics/*.json", { eager: true });

/** Question bank, keyed by item id (bundled, so tests run offline). */
export const ITEMS: Record<string, ItemParams & { subskill: string }> = Object.fromEntries(
  Object.values(itemModules).flatMap((m) => m.default).map((it) => [it.id, it]));
export const RUBRICS: Record<string, Rubric> = Object.fromEntries(
  Object.values(rubricModules).map((m) => [m.default.id, m.default]));

export async function profileOf(studentId: string, now = Date.now()): Promise<Profile> {
  const events = await db.events.where("student_id").equals(studentId).toArray();
  return foldEvents(events, kb.graph!, { now, items: ITEMS, rubrics: RUBRICS });
}

/** Recomputes and stores the cached levels for one student. */
export async function refreshSkillState(studentId: string): Promise<Profile> {
  const profile = await profileOf(studentId);
  const now = Date.now();
  await db.transaction("rw", db.skillState, async () => {
    await db.skillState.where("student_id").equals(studentId).delete();
    await db.skillState.bulkPut(Object.values(profile.units).map((u) => ({
      student_id: studentId, subskill_id: u.id, p_level: u.p, updated_at: now,
    })));
  });
  return profile;
}
