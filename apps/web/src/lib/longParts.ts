// Crash safety for a long task: each saved part of the recording (every 10 s, already blurred) is kept on this
// phone as it is made, so if the app or the phone stops, the work so far is not lost. Only one recording at a time.
// Kept in the local "meta" table; nothing here leaves the phone, and it is cleared once the video is saved.

import { db } from "./db";

const META = "rec:current";
const part = (session: string, i: number) => `rec:${session}:${i}`;

export interface PartsMeta { session: string; student_id: string; rubric_id: string; started_at: number; parts: number; mime: string }

/** Starts a new set of parts (clearing any older one). */
export async function beginParts(studentId: string, rubricId: string, mime: string): Promise<void> {
  await clearParts();
  const meta: PartsMeta = { session: String(Date.now()), student_id: studentId, rubric_id: rubricId, started_at: Date.now(), parts: 0, mime };
  await db.meta.put({ key: META, value: meta });
}

/** Adds one saved part. Parts are written in order (the recorder hands them over one at a time). */
export async function addPart(blob: Blob): Promise<void> {
  const row = await db.meta.get(META);
  const meta = row?.value as PartsMeta | undefined;
  if (!meta) return;
  await db.meta.put({ key: part(meta.session, meta.parts), value: blob });
  await db.meta.put({ key: META, value: { ...meta, parts: meta.parts + 1, mime: meta.mime || blob.type } });
}

/** An unfinished long recording for this student and checklist, if one was left behind. */
export async function leftover(studentId: string, rubricId: string): Promise<PartsMeta | null> {
  const meta = (await db.meta.get(META))?.value as PartsMeta | undefined;
  return meta && meta.student_id === studentId && meta.rubric_id === rubricId && meta.parts > 0 ? meta : null;
}

/** Joins the saved parts back into one video. */
export async function joinParts(meta: PartsMeta): Promise<Blob> {
  const blobs: Blob[] = [];
  for (let i = 0; i < meta.parts; i++) {
    const b = (await db.meta.get(part(meta.session, i)))?.value;
    if (b instanceof Blob) blobs.push(b);
  }
  return new Blob(blobs, { type: (meta.mime || "video/webm").split(";")[0] });
}

/** Removes the saved parts (after the video is saved, or when she discards them). */
export async function clearParts(): Promise<void> {
  const keys = (await db.meta.toCollection().primaryKeys()).filter((k) => String(k).startsWith("rec:"));
  await db.meta.bulkDelete(keys as string[]);
}
