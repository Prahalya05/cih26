// The only place the app writes evidence events. Events are never edited or deleted
// (except when a student deletes all her data). Skill levels are rebuilt from them.

import { ulid, validateEvent, type EvidenceEvent } from "@disha/engine";
import { db } from "./db";
import { refreshSkillState } from "./skills";

export type NewEvent = Omit<EvidenceEvent, "id" | "device_id" | "created_at">;

let deviceIdCache: string | null = null;

/** A random id for this phone, made the first time the app runs. */
export async function deviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  const row = await db.meta.get("device_id");
  if (row && typeof row.value === "string") return (deviceIdCache = row.value);
  const id = ulid();
  await db.meta.put({ key: "device_id", value: id });
  return (deviceIdCache = id);
}

/** This phone's rater id when a teacher or facilitator uses it. */
export async function raterId(): Promise<string> {
  return `rater_${await deviceId()}`;
}

/** Saves one event. Returns it, or null if it was invalid (the reason goes to the console). */
export async function recordEvent(e: NewEvent, at = Date.now()): Promise<EvidenceEvent | null> {
  const event: EvidenceEvent = { ...e, id: ulid(at), device_id: await deviceId(), created_at: at };
  const problems = validateEvent(event);
  if (problems.length) {
    console.warn("[disha] event not saved:", problems.join("; "), event);
    return null;
  }
  const student = await db.students.get(e.student_id);
  await db.events.put({ ...event, synced: student?.simulated ? 1 : 0 }); // demo students never sync
  await refreshSkillState(e.student_id);
  return event;
}

export async function recordEvents(list: NewEvent[]): Promise<void> {
  const at = Date.now();
  // Space the timestamps by 1 ms so ids keep the order the events were made in.
  for (let i = 0; i < list.length; i++) await recordEvent(list[i], at + i);
}

export const eventsOf = (studentId: string) => db.events.where("student_id").equals(studentId).sortBy("id");
