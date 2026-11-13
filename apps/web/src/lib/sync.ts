// Talks to the Disha API. Everything here is optional: the student flow works without it.

import { db, type Action, type SkillClaim, type Student } from "./db";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export const isOnline = () => navigator.onLine;

export async function syncNow(): Promise<boolean> {
  if (!isOnline()) return false;
  const students = (await db.students.toArray()).filter((s) => !s.simulated && (!s.synced_at || s.updated_at > s.synced_at));
  // Demo (made-up) students never leave the phone.
  const actions = (await db.actions.where("synced").equals(0).toArray()).filter((a) => !a.student_id.startsWith("demo_"));
  const allIds = (await db.students.toArray()).filter((s) => !s.simulated).map((s) => s.id);
  try {
    const res = await fetch(`${API}/v1/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        students,
        actions: actions.map(({ synced: _s, ...a }) => a),
        pull: allIds, // get teacher actions back for every student on this phone
      }),
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { actions: Omit<Action, "synced">[] };
    const now = Date.now();
    await db.transaction("rw", db.students, db.actions, async () => {
      for (const s of students) await db.students.update(s.id, { synced_at: now });
      for (const a of actions) await db.actions.update(a.id, { synced: 1 });
      for (const a of out.actions) await db.actions.put({ ...a, synced: 1 });
    });
    return true;
  } catch {
    return false;
  }
}

export async function pullCohort(code: string): Promise<boolean> {
  if (!isOnline()) return false;
  try {
    const res = await fetch(`${API}/v1/facilitator/${encodeURIComponent(code)}/cohort`);
    if (!res.ok) return false;
    const out = (await res.json()) as { students: Student[]; actions: Omit<Action, "synced">[] };
    await db.transaction("rw", db.students, db.actions, async () => {
      for (const s of out.students) {
        const local = await db.students.get(s.id);
        if (!local || local.updated_at < s.updated_at) await db.students.put({ ...s, synced_at: s.updated_at });
      }
      for (const a of out.actions) await db.actions.put({ ...a, synced: 1 });
    });
    return true;
  } catch {
    return false;
  }
}

export interface Extracted {
  transcript: string;
  skills: SkillClaim[];
  source: "gemini" | "keywords" | "unavailable";
}

export async function extractRemote(question: string, input: { text?: string; audio?: Blob }): Promise<Extracted | null> {
  if (!isOnline()) return null;
  const form = new FormData();
  form.set("question", question);
  if (input.text) form.set("text", input.text);
  if (input.audio) form.set("audio", input.audio, "answer.webm");
  try {
    const res = await fetch(`${API}/v1/profile/extract`, { method: "POST", body: form });
    if (!res.ok) return null;
    const out = await res.json();
    const source: SkillClaim["source"] = input.audio ? "voice" : "text";
    return { ...out, skills: (out.skills ?? []).map((s: SkillClaim) => ({ ...s, source })) };
  } catch {
    return null;
  }
}
