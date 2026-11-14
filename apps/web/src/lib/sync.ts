// Talks to the Disha API. Everything here is optional: the student flow works without it.

import type { EvidenceEvent } from "@disha/engine";
import { db, deleteStudent, hasScope, type Action, type SkillClaim, type StoredEvent, type Student } from "./db";
import { deviceId } from "./events";
import { refreshSkillState } from "./skills";

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export const isOnline = () => navigator.onLine;

export async function syncNow(): Promise<boolean> {
  if (!isOnline()) return false;
  await flushErasures();
  // Demo (made-up) students never leave the phone; nor does anyone whose consent is missing or withdrawn.
  const shared = (await db.students.toArray()).filter((s) => !s.simulated && hasScope(s, "assess"));
  const sharedIds = new Set(shared.map((s) => s.id));
  const students = shared.filter((s) => !s.synced_at || s.updated_at > s.synced_at);
  const actions = (await db.actions.where("synced").equals(0).toArray()).filter((a) => sharedIds.has(a.student_id));
  const allIds = [...sharedIds];
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
    return await syncEvents();
  } catch {
    return false;
  }
}

// ---------- v2: evidence events ----------

const BATCH = 200;
/** Server answers that mean "try again later" rather than "this event is wrong". */
const RETRY = ["refers_to an event the server does not have yet", "no consent to assess this student"];

interface SyncOut {
  accepted: string[];
  rejected: { id: string; errors: string[] }[];
  events: EvidenceEvent[];
  cursor: number;
  more: boolean;
}

/** Sends this phone's new events and fetches events made on other devices (teacher ratings and so on). */
export async function syncEvents(): Promise<boolean> {
  if (!isOnline()) return false;
  const device = await deviceId();
  // Students with withdrawn consent are still sent (so the server records the withdrawal), but none of
  // their events go up and the server sends nothing back for them.
  const real = (await db.students.toArray()).filter((s) => !s.simulated && s.consent);
  const studentIds = real.filter((s) => hasScope(s, "assess")).map((s) => s.id);
  const pending = (await db.events.where("synced").equals(0).sortBy("id")).filter((e) => studentIds.includes(e.student_id));
  const myRater = `rater_${device}`;
  const raters = pending.some((e) => e.rater_id === myRater) ? [{ id: myRater, role: "teacher" }] : [];
  const chunks: StoredEvent[][] = [];
  for (let i = 0; i < pending.length; i += BATCH) chunks.push(pending.slice(i, i + BATCH));
  if (chunks.length === 0) chunks.push([]); // nothing to send, but still fetch
  let cursor = Number((await db.meta.get("event_cursor"))?.value ?? 0);

  const post = async (events: StoredEvent[]): Promise<SyncOut | null> => {
    const res = await fetch(`${API}/v2/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: device,
        students: real.map(studentForServer),
        raters,
        events: events.map(({ synced: _s, sync_error: _e, ...e }) => e),
        cursor,
        student_ids: studentIds,
      }),
    });
    return res.ok ? ((await res.json()) as SyncOut) : null;
  };

  const save = async (out: SyncOut) => {
    await db.transaction("rw", db.events, db.meta, async () => {
      for (const id of out.accepted) await db.events.update(id, { synced: 1, sync_error: undefined });
      for (const r of out.rejected) {
        const retry = r.errors.every((x) => RETRY.includes(x));
        await db.events.update(r.id, { synced: retry ? 0 : 2, sync_error: r.errors.join("; ") });
      }
      for (const e of out.events) if (!(await db.events.get(e.id))) await db.events.put({ ...e, synced: 1 });
      await db.meta.put({ key: "event_cursor", value: out.cursor });
    });
    cursor = out.cursor;
    for (const sid of new Set(out.events.map((e) => e.student_id))) await refreshSkillState(sid);
  };

  try {
    for (const chunk of chunks) {
      let out = await post(chunk);
      if (!out) return false;
      await save(out);
      while (out.more) {
        out = await post([]);
        if (!out) return false;
        await save(out);
      }
    }
    return true;
  } catch {
    return false;
  }
}

function studentForServer(s: Student) {
  const c = s.consent;
  return {
    id: s.id,
    name: s.name,
    facilitator_code: s.facilitator_code ?? null,
    birth_year: s.birth_year ?? null,
    consent: c ? {
      id: `consent_${s.id}`,
      scopes: c.scopes ?? ["assess", ...(c.photos ? ["photos"] : [])],
      method: c.method ?? "paper_form",
      granted_at: c.at,
      guardian_name: c.guardian_name ?? null,
      revoked_at: c.revoked_at ?? null,
    } : null,
  };
}

// ---------- delete my data (Step 11.2) ----------

const ERASE_KEY = "pending_erasures";
type Erasure = { id: string; by: "guardian" | "student" };

/**
 * Deletes everything about a student on this phone at once, and on the server now or at the next sync.
 * Only the student id is kept until the server confirms, so the request is not lost when offline.
 */
export async function eraseStudent(id: string, confirmedBy: "guardian" | "student"): Promise<void> {
  const synced = !id.startsWith("demo_") && !(await db.students.get(id))?.simulated;
  await deleteStudent(id);
  if (!synced) return;
  const list = ((await db.meta.get(ERASE_KEY))?.value as Erasure[] | undefined) ?? [];
  await db.meta.put({ key: ERASE_KEY, value: [...list.filter((x) => x.id !== id), { id, by: confirmedBy }] });
  await flushErasures();
}

async function flushErasures(): Promise<void> {
  if (!isOnline()) return;
  const list = ((await db.meta.get(ERASE_KEY))?.value as Erasure[] | undefined) ?? [];
  if (list.length === 0) return;
  const left: Erasure[] = [];
  for (const x of list) {
    try {
      const res = await fetch(`${API}/v2/student/${encodeURIComponent(x.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed_by: x.by }),
      });
      if (!res.ok) left.push(x);
    } catch {
      left.push(x);
    }
  }
  await db.meta.put({ key: ERASE_KEY, value: left });
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
