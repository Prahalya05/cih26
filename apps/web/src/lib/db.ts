// On-phone storage (IndexedDB). Several students can share one phone; each has their own record.
// Teacher actions are saved here first and sent to the server when there is internet.

import Dexie, { type EntityTable } from "dexie";

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

export interface Student {
  id: string;
  name: string;
  avatar: string;
  facilitator_code?: string;
  consent?: { at: number };
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

export const db = new Dexie("disha") as Dexie & {
  students: EntityTable<Student, "id">;
  actions: EntityTable<Action, "id">;
};

db.version(1).stores({
  students: "id, facilitator_code, updated_at, synced_at",
  actions: "id, student_id, kind, synced",
});

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
  await db.transaction("rw", db.students, db.actions, async () => {
    await db.students.delete(id);
    await db.actions.where("student_id").equals(id).delete();
  });
}
