// Aim High on the phone: the pathways knowledge base (bundled, works offline) and each student's quiz
// answers, practice cards, goal and weekly study hours. Kept in IndexedDB (meta table) on this phone only;
// nothing here is synced, so it never reaches the server or the teacher.

import {
  abilities, buildPathways, review, startOf, type Ability, type Card, type Exam, type PathEdge, type PathNode,
  type QuizAnswer, type Start, type Subject, type SubjectItem, type Track,
} from "@disha/engine";
import graph from "@kb/pathways/graph.json";
import exams from "@kb/pathways/exams.json";
import items from "@kb/pathways/items.json";
import subjects from "@kb/pathways/subjects.json";
import tracks from "@kb/pathways/tracks.json";
import type { ChoiceItem } from "../components/Items";
import { db, type Student } from "./db";

export const pw = buildPathways({
  nodes: graph.nodes as PathNode[],
  edges: graph.edges as PathEdge[],
  exams: exams as Exam[],
  tracks: tracks as unknown as Track[],
  subjects: subjects as Subject[],
});

export type AimItem = SubjectItem & ChoiceItem & { why: { en: string; ta: string } };
export const AIM_ITEMS: Record<string, AimItem> = Object.fromEntries((items as unknown as AimItem[]).map((i) => [i.id, i]));

export interface AimState {
  answers: (QuizAnswer & { mode: "check" | "practice" })[];
  cards: Record<string, Card>;
  goal?: string;
  hours?: number;
}

export const DEFAULT_HOURS = 8;
const EMPTY: AimState = { answers: [], cards: {} };
export const aimKey = (studentId: string) => `aim.${studentId}`;

export async function loadAim(studentId: string): Promise<AimState> {
  const row = await db.meta.get(aimKey(studentId));
  return { ...EMPTY, ...(row?.value as AimState | undefined) };
}

/** Read, change, write in one transaction, so two quick taps never overwrite each other. */
export async function patchAim(studentId: string, change: (s: AimState) => AimState) {
  await db.transaction("rw", db.meta, async () => {
    await db.meta.put({ key: aimKey(studentId), value: change(await loadAim(studentId)) });
  });
}

/** Save one quiz or practice answer and move its practice card (Leitner). */
export function recordAim(studentId: string, item: string, correct: boolean, mode: "check" | "practice") {
  const at = Date.now();
  return patchAim(studentId, (s) => ({
    ...s,
    answers: [...s.answers, { item, correct, at, mode }],
    cards: { ...s.cards, [item]: review(s.cards[item], correct, dayNumber(at)) },
  }));
}

export const dayNumber = (t = Date.now()) => Math.floor(t / 86_400_000);

export const abilitiesOf = (s: AimState): Record<string, Ability> => abilities(s.answers, AIM_ITEMS);

/** Where she is now on the route graph, from the facts she already gave. */
export function startOfStudent(student: Student): Start {
  const f = student.factAnswers;
  const level = f.level as string | undefined;
  const stream = (level === "ug" ? f.degree : f.stream) as string | undefined;
  return startOf(level, stream, f.year_of_study as number | undefined);
}

export const ageOf = (student: Student): number | undefined => {
  const a = student.factAnswers.age;
  if (typeof a === "number") return a;
  return student.birth_year ? new Date().getFullYear() - student.birth_year : undefined;
};

export const subjectItems = (subject: string) => Object.values(AIM_ITEMS).filter((i) => i.subject === subject);
