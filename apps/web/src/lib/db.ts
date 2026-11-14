// On-phone storage (IndexedDB). Several students can share one phone; each has their own record.
// Teacher actions are saved here first and sent to the server when there is internet.

import { isMinor, ulid, type EvidenceEvent } from "@disha/engine";
import Dexie, { type EntityTable, type Table } from "dexie";

export interface SkillClaim {
  id: string;
  confidence: number;
  evidence: string;
  source: "tap" | "voice" | "text";
}

export interface Answer {
  qid: string;
  chips: string[];
  text?: string;
  transcript?: string;
  extracted?: SkillClaim[];
  via?: "gemini" | "keywords" | "unavailable";
}

/** What the parent (or a student aged 18+) agreed to. Each scope switches one feature on. */
export type Scope = "assess" | "photos" | "share_portfolio";
export type ConsentMethod = "paper_form" | "otp" | "self_18plus";

export interface Consent {
  at: number;
  scopes?: Scope[];
  method?: ConsentMethod;
  guardian_name?: string;
  /** Set when consent is withdrawn: nothing more is sent or fetched for her. */
  revoked_at?: number;
  /** Old (version 1) records: photo checking was the only separate choice. */
  photos?: boolean;
}

export interface Student {
  id: string;
  name: string;
  avatar: string;
  facilitator_code?: string;
  birth_year?: number;
  consent?: Consent;
  cards: Record<string, boolean>;
  answers: Record<string, Answer>;
  factAnswers: Record<string, unknown>;
  simulated?: boolean;
  updated_at: number;
  synced_at?: number;
}

export interface Action {
  id: string;
  student_id: string;
  kind: "endorse" | "recommend" | "feedback" | "checkin";
  payload: Record<string, unknown>;
  by?: string;
  created_at: number;
  synced: 0 | 1;
}

/** An evidence event as stored on the phone. synced: 0 waiting, 1 on the server, 2 refused by the server. */
export type StoredEvent = EvidenceEvent & { synced: 0 | 1 | 2; sync_error?: string };

/** Cached skill level for one sub-skill (rebuilt from events, safe to delete). */
export interface SkillStateRow {
  student_id: string;
  subskill_id: string;
  p_level: number[];
  updated_at: number;
}

export interface MediaRow {
  id: string;
  student_id: string;
  event_id: string;
  blob: Blob;
  created_at: number;
}

export const db = new Dexie("disha") as Dexie & {
  students: EntityTable<Student, "id">;
  actions: EntityTable<Action, "id">;
  events: EntityTable<StoredEvent, "id">;
  skillState: Table<SkillStateRow, [string, string]>;
  items: Table<{ id: string; subskill_id: string; [k: string]: unknown }, string>;
  media: EntityTable<MediaRow, "id">;
  meta: Table<{ key: string; value: unknown }, string>;
};

db.version(1).stores({
  students: "id, facilitator_code, updated_at, synced_at",
  actions: "id, student_id, kind, synced",
});

// Version 2 adds the evidence log. Old answers, cards and endorsements are copied into events once.
db.version(2).stores({
  students: "id, facilitator_code, updated_at, synced_at",
  actions: "id, student_id, kind, synced",
  events: "id, student_id, kind, subskill_id, created_at, synced",
  skillState: "[student_id+subskill_id], student_id",
  items: "id, subskill_id",
  media: "id, student_id, event_id",
  meta: "key",
}).upgrade(async (tx) => {
  const deviceId = ulid();
  await tx.table("meta").put({ key: "device_id", value: deviceId });
  const students = (await tx.table("students").toArray()) as Student[];
  const actions = (await tx.table("actions").toArray()) as Action[];
  for (const s of students) {
    const events = eventsFromLegacy(s, actions.filter((a) => a.student_id === s.id), deviceId);
    await tx.table("events").bulkPut(events.map((e) => ({ ...e, synced: s.simulated ? 1 : 0 })));
  }
});

/** Turns a version-1 student (chips, voice answers, cards, teacher endorsements) into evidence events. */
export function eventsFromLegacy(s: Student, actions: Action[], deviceId: string): EvidenceEvent[] {
  const out: EvidenceEvent[] = [];
  const at = s.consent?.at ?? s.updated_at;
  const base = { student_id: s.id, device_id: deviceId };
  let n = 0;
  const id = () => ulid(at + n++); // n keeps ids unique and in a stable order
  for (const a of Object.values(s.answers ?? {})) {
    for (const skill of a.chips) {
      out.push({ ...base, id: id(), kind: "self_report", skill_id: skill, payload: { source: "tap", qid: a.qid }, created_at: at });
    }
    for (const x of a.extracted ?? []) {
      out.push({ ...base, id: id(), kind: "self_report", skill_id: x.id,
        payload: { source: x.source, qid: a.qid, evidence: x.evidence, confidence: x.confidence }, created_at: at });
    }
  }
  for (const [card, like] of Object.entries(s.cards ?? {})) {
    out.push({ ...base, id: id(), kind: "interest_choice", payload: { card, like }, created_at: at });
  }
  for (const act of actions) {
    if (act.kind !== "endorse") continue;
    out.push({ ...base, id: ulid(act.created_at), kind: "rating", rater_id: `rater_${act.by ?? "teacher"}_legacy`,
      skill_id: String(act.payload.skill_id), payload: { endorse: true }, created_at: act.created_at });
  }
  return out;
}

/** The scopes in force now (none after withdrawal). Old records without scopes had assess, plus photos if ticked. */
export function scopesOf(s: Pick<Student, "consent"> | undefined): Scope[] {
  const c = s?.consent;
  if (!c || c.revoked_at) return [];
  return c.scopes ?? ["assess", ...(c.photos ? (["photos"] as Scope[]) : [])];
}

export const hasScope = (s: Pick<Student, "consent"> | undefined, scope: Scope) => scopesOf(s).includes(scope);

/** Under 18, or age not known (Step 11.3). */
export const isMinorStudent = (s: Pick<Student, "birth_year"> | undefined) => isMinor(s?.birth_year);

export const newId = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/-/g, "").slice(0, 16);

export async function saveStudent(s: Student) {
  await db.students.put({ ...s, updated_at: Date.now() });
}

/** Read the latest copy, change it, save it — so quick taps never overwrite each other. */
export async function patchStudent(id: string, change: (s: Student) => Student) {
  await db.transaction("rw", db.students, async () => {
    const cur = await db.students.get(id);
    if (cur) await db.students.put({ ...change(cur), updated_at: Date.now() });
  });
}

export async function addAction(a: Omit<Action, "id" | "created_at" | "synced">) {
  await db.actions.put({ ...a, id: newId(), created_at: Date.now(), synced: 0 });
}

export async function deleteStudent(id: string) {
  await db.transaction("rw", [db.students, db.actions, db.events, db.skillState, db.media], async () => {
    await db.students.delete(id);
    await db.actions.where("student_id").equals(id).delete();
    await db.events.where("student_id").equals(id).delete();
    await db.skillState.where("student_id").equals(id).delete();
    await db.media.where("student_id").equals(id).delete();
  });
}
