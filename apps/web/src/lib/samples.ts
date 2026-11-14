// Work samples: a photo of something she made, scored against a checklist.
// Saved on the phone first (works offline, as a "pending" sample). When online and her parent agreed to
// photo checking, the photo is sent once for AI scoring; the result is a new work_sample event that
// replaces the pending one. A teacher then confirms or corrects the scores (a rating event).

import { safeRubric, type EvidenceEvent } from "@disha/engine";
import { db, hasScope, isMinorStudent, newId, type Student, type StoredEvent } from "./db";
import { kb } from "./kb";
import { RUBRICS } from "./skills";
import { recordEvent } from "./events";
import { isOnline, syncEvents } from "./sync";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const MAX_SIDE = 1280;

export interface RubricFull {
  id: string;
  skill: string;
  name: { en: string; ta?: string };
  capture: { en: string; ta?: string };
  criteria: { id: string; subskill?: string; name: { en: string; ta?: string }; scores: Record<"0" | "1" | "2", string> }[];
}

export interface ScoreResult {
  scores: Record<string, number>;
  reasons: Record<string, string>;
  cannot_see: string[];
}

/**
 * The checklist this student may be given. Under 18 (or age unknown), items on hazardous sub-skills are
 * removed; null when nothing safe is left (Step 11.3).
 */
export function rubricFor(student: Pick<Student, "birth_year"> | undefined, rubricId: string): RubricFull | null {
  const full = RUBRICS[rubricId] as unknown as RubricFull | undefined;
  return full ? safeRubric(kb.graph!, full, isMinorStudent(student)) : null;
}

/** Shrinks a camera photo to at most 1280 px on the long side, JPEG quality 0.75 (about 150 KB). */
export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.75));
}

/** Saves the photo on the phone and records a pending work sample. Returns the event id. */
export async function saveSample(studentId: string, rubric: RubricFull, photo: Blob): Promise<string | null> {
  const mediaId = newId();
  const ev = await recordEvent({
    student_id: studentId, kind: "work_sample", skill_id: rubric.skill,
    payload: { rubric_id: rubric.id, scorer: "pending", media_ref: mediaId },
  });
  if (!ev) return null;
  await db.media.put({ id: mediaId, student_id: studentId, event_id: ev.id, blob: photo, created_at: Date.now() });
  return ev.id;
}

/** Sends a pending sample for AI scoring. Returns the scores, or null if offline, no consent, or AI unavailable. */
export async function scoreSample(pending: EvidenceEvent): Promise<ScoreResult | null> {
  if (!isOnline()) return null;
  const student = await db.students.get(pending.student_id);
  if (!hasScope(student, "photos")) return null;
  const media = await db.media.get(String(pending.payload.media_ref));
  if (!media) return null;
  await syncEvents(); // the server must know about the consent and the sample first
  const form = new FormData();
  form.set("student_id", pending.student_id);
  form.set("rubric_id", String(pending.payload.rubric_id));
  form.set("image", media.blob, "work.jpg");
  try {
    const res = await fetch(`${API}/v2/work-sample/score`, { method: "POST", body: form });
    if (!res.ok) return null;
    const out = (await res.json()) as ScoreResult;
    if (Object.keys(out.scores).length > 0) {
      await recordEvent({
        student_id: pending.student_id, kind: "work_sample", skill_id: pending.skill_id,
        payload: { rubric_id: pending.payload.rubric_id, scorer: "ai", scores: out.scores, reasons: out.reasons,
          cannot_see: out.cannot_see, media_ref: pending.payload.media_ref, replaces: pending.id },
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Samples still waiting for a score (no AI result yet), oldest first. */
export async function pendingSamples(studentId?: string): Promise<StoredEvent[]> {
  const all = await (studentId ? db.events.where("student_id").equals(studentId).toArray() : db.events.toArray());
  const replaced = new Set(all.filter((e) => e.kind === "work_sample" && e.payload.replaces).map((e) => String(e.payload.replaces)));
  const confirmed = new Set(all.filter((e) => e.kind === "rating" && e.refers_to).map((e) => e.refers_to));
  return all.filter((e) => e.kind === "work_sample" && e.payload.scorer === "pending" && !replaced.has(e.id) && !confirmed.has(e.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Tries AI scoring for every pending sample on this phone (called after sync). */
export async function scorePending(): Promise<void> {
  for (const e of await pendingSamples()) await scoreSample(e);
}

/** Samples a teacher has not yet checked: the latest version of each (AI-scored or still pending). */
export async function samplesToConfirm(studentIds: string[]): Promise<StoredEvent[]> {
  const all = (await db.events.toArray()).filter((e) => studentIds.includes(e.student_id));
  const replaced = new Set(all.filter((e) => e.kind === "work_sample" && e.payload.replaces).map((e) => String(e.payload.replaces)));
  const confirmed = new Set(all.filter((e) => e.kind === "rating" && e.refers_to).map((e) => e.refers_to));
  return all.filter((e) => e.kind === "work_sample" && !replaced.has(e.id) && !confirmed.has(e.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}
