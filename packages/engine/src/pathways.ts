// Aim High: routes from where a student is now to careers that need higher study (doctor, engineer, CA,
// lawyer, IAS…), how ready she is for each, and a study plan to close the gap. Runs on the phone, offline.
//
//   Routes      Dijkstra over a graph of study stages (Class 10 → Class 11–12 group → degree → goal), with
//               age limits checked while searching. Which Class 11 group keeps the most doors open.
//   Readiness   Subject abilities from short adaptive quizzes (the same IRT as the skill tests), projected
//               forward by the months left to study, against a rough bar for each track.
//   Study plan  Topics in prerequisite order (Kahn's topological sort) with a priority queue that puts
//               the biggest, cheapest gains first, packed into weeks of her chosen hours.
//   Practice    Leitner spaced repetition: a missed question comes back tomorrow, a known one in weeks.

import { eap, pCorrect, prior, se, update, type ItemParams } from "./irt.ts";
import type { Lang } from "./types.ts";

// ---------- knowledge base shapes (packages/kb/pathways) ----------

export interface PathNode { id: string; kind: "school" | "stream" | "course" | "goal"; name: Lang }
export interface PathEdge { from: string; to: string; years: number; exams?: string[]; note?: Lang; max_age?: number }
export interface Exam { id: string; name: string; body: string; url: string | null; when: Lang }
export interface Track {
  id: string; emoji: string; sector: string; riasec: string; goals: string[]; bar: number; quota_7_5: boolean;
  name: Lang; roles: Lang[]; subjects: Record<string, number>; skills: string[]; schemes: string[]; help: Lang[];
  source_url: string; needs_verification?: boolean;
}
export interface Topic { id: string; name: Lang; hours: number; b: number; after: string[] }
export interface Subject { id: string; emoji: string; name: Lang; topics: Topic[] }
export type SubjectItem = ItemParams & { subject: string; topic: string };

export interface Pathways {
  nodes: Record<string, PathNode>;
  out: Record<string, PathEdge[]>;
  exams: Record<string, Exam>;
  tracks: Track[];
  subjects: Record<string, Subject>;
}

export function buildPathways(raw: { nodes: PathNode[]; edges: PathEdge[]; exams: Exam[]; tracks: Track[]; subjects: Subject[] }): Pathways {
  const out: Record<string, PathEdge[]> = {};
  for (const n of raw.nodes) out[n.id] = [];
  for (const e of raw.edges) (out[e.from] ??= []).push(e);
  return {
    nodes: Object.fromEntries(raw.nodes.map((n) => [n.id, n])),
    out,
    exams: Object.fromEntries(raw.exams.map((x) => [x.id, x])),
    tracks: raw.tracks,
    subjects: Object.fromEntries(raw.subjects.map((s) => [s.id, s])),
  };
}

// ---------- where she is now ----------

/** Class 11–12 groups and degree types a student can name. */
export const STREAMS = ["pcmb", "pcm", "pcb", "commerce", "humanities"] as const;
export const DEGREES = ["ug_science", "ug_commerce", "ug_arts", "btech"] as const;

export interface Start {
  node: string;
  /** Years until she finishes the stage she is in now. */
  years: number;
  /** In Class 11–12 or college but we don't know her group yet: routes are shown from Class 10 meanwhile. */
  needs: "stream" | "degree" | null;
}

/**
 * level is the app's study-level answer ("8".."12", "iti", "diploma", "ug", "out"); stream is a Class 11–12
 * group or a degree type; year is the year of study for diploma and college.
 */
export function startOf(level: string | undefined, stream?: string, year?: number): Start {
  const left = (total: number) => Math.max(0.5, total - (year ?? 1) + 1);
  if (!level) return { node: "c10", years: 1, needs: null };
  if (/^\d+$/.test(level)) {
    const cls = Number(level);
    if (cls <= 10) return { node: "c10", years: 10 - cls + 1, needs: null };
    const known = (STREAMS as readonly string[]).includes(stream ?? "");
    if (!known) return { node: "c10", years: 0, needs: "stream" };
    return { node: `c12_${stream}`, years: cls === 11 ? 2 : 1, needs: null };
  }
  if (level === "iti") return { node: "iti", years: 1, needs: null };
  if (level === "diploma") return { node: "diploma", years: left(3), needs: null };
  if (level === "ug") {
    if (!(DEGREES as readonly string[]).includes(stream ?? "")) return { node: "c10", years: 0, needs: "degree" };
    return { node: stream!, years: left(stream === "btech" ? 4 : 3), needs: null };
  }
  return { node: "c10", years: 0, needs: null }; // not studying now: she can restart from Class 10 level
}

// ---------- routes (Dijkstra with an age limit) ----------

export interface Route {
  steps: PathEdge[];
  /** Years from today, including finishing the current stage. */
  years: number;
}

/**
 * Shortest route (in years) from `start` to any of `goals`. Edges with an age limit are usable only if
 * she will still be young enough when she reaches them. Because arrival times only grow along a path,
 * the first time Dijkstra settles a node is also the youngest she can be there, so the check is exact.
 * Ties break on fewer steps, then on node id, so the answer is the same on every phone.
 */
export function shortestRoute(pw: Pathways, start: Start, goals: string[], age?: number): Route | null {
  const goalSet = new Set(goals);
  const best = new Map<string, { t: number; steps: PathEdge[] }>([[start.node, { t: start.years, steps: [] }]]);
  const done = new Set<string>();
  // The graph is small (under 30 nodes), so a sorted array is a fine priority queue.
  const queue: { node: string; t: number; steps: PathEdge[] }[] = [{ node: start.node, t: start.years, steps: [] }];
  while (queue.length) {
    queue.sort((a, b) => a.t - b.t || a.steps.length - b.steps.length || (a.node < b.node ? -1 : 1));
    const cur = queue.shift()!;
    if (done.has(cur.node)) continue;
    done.add(cur.node);
    if (goalSet.has(cur.node)) return { steps: cur.steps, years: round1(cur.t) };
    for (const e of pw.out[cur.node] ?? []) {
      if (e.max_age !== undefined && age !== undefined && age + cur.t > e.max_age) continue;
      const t = cur.t + e.years;
      const prev = best.get(e.to);
      if (prev && (prev.t < t || (prev.t === t && prev.steps.length <= cur.steps.length + 1))) continue;
      const next = { t, steps: [...cur.steps, e] };
      best.set(e.to, next);
      queue.push({ node: e.to, ...next });
    }
  }
  return null;
}

/** Every node reachable from `from` (breadth-first), ignoring age limits. */
export function reachable(pw: Pathways, from: string): Set<string> {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) for (const e of pw.out[todo.pop()!] ?? []) if (!seen.has(e.to)) { seen.add(e.to); todo.push(e.to); }
  return seen;
}

export type DoorStatus = "open" | "closed" | "age";

export interface Door {
  track: Track;
  status: DoorStatus;
  route: Route | null;
  /** From Class 10: the Class 11–12 groups (or diploma/ITI) that lead to this track at all. */
  via: string[];
}

/** For every track: still open from where she is, and the shortest way there. */
export function doors(pw: Pathways, start: Start, age?: number): Door[] {
  const firstSteps = start.node === "c10" ? (pw.out.c10 ?? []).map((e) => e.to) : [];
  return pw.tracks.map((track) => {
    const route = shortestRoute(pw, start, track.goals, age);
    const anyRoute = route ?? shortestRoute(pw, start, track.goals);
    const status: DoorStatus = route ? "open" : anyRoute ? "age" : "closed";
    const via = firstSteps.filter((s) => track.goals.some((g) => reachable(pw, s).has(g)));
    return { track, status, route: route ?? anyRoute, via };
  });
}

export interface StreamOption {
  node: string;
  /** Tracks still open after choosing this. */
  open: string[];
  /** Same, weighted by how much each track fits her interests (0..1 each). */
  value: number;
}

/**
 * The Class 10 decision: for each next step, which tracks stay reachable. Choosing a group closes doors
 * for good (no Maths in Class 12 means no engineering), so the option that keeps the doors she cares
 * about open is worth knowing before she picks.
 */
export function streamOptions(pw: Pathways, interest: (t: Track) => number = () => 1): StreamOption[] {
  return (pw.out.c10 ?? []).map((e) => {
    const r = reachable(pw, e.to);
    const open = pw.tracks.filter((t) => t.goals.some((g) => r.has(g)));
    return { node: e.to, open: open.map((t) => t.id), value: round2(open.reduce((s, t) => s + interest(t), 0)) };
  }).sort((a, b) => b.value - a.value || b.open.length - a.open.length);
}

/** How well a track's interest code (e.g. "ISR") matches her RIASEC scores (0..1 per letter). */
export function interestFit(track: Track, riasec: Partial<Record<string, number>> = {}): number {
  const w = [1, 0.6, 0.3];
  let s = 0, d = 0;
  [...track.riasec].forEach((ch, i) => { s += (riasec[ch] ?? 0) * w[i]; d += w[i]; });
  return d ? round2(s / d) : 0;
}

// ---------- abilities from quiz answers ----------

export interface Ability { theta: number; se: number; n: number }
export interface QuizAnswer { item: string; correct: boolean; at: number }

/**
 * Ability per subject from her answers. Only the latest answer to each question counts, so practising
 * the same question again does not inflate the estimate. A subject with no answers keeps the prior.
 */
export function abilities(answers: QuizAnswer[], items: Record<string, SubjectItem>): Record<string, Ability> {
  const latest = new Map<string, QuizAnswer>();
  for (const a of [...answers].sort((x, y) => x.at - y.at)) latest.set(a.item, a);
  const post: Record<string, number[]> = {};
  const n: Record<string, number> = {};
  for (const a of latest.values()) {
    const it = items[a.item];
    if (!it) continue;
    post[it.subject] = update(post[it.subject] ?? prior(), it, a.correct);
    n[it.subject] = (n[it.subject] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(post).map(([s, p]) => [s, { theta: round2(eap(p)), se: round2(se(p)), n: n[s] }]));
}

const PRIOR_ABILITY: Ability = { theta: 0, se: 1.2, n: 0 };

// ---------- readiness ----------

/** Ability gained per month of steady study. A planning assumption, not a measured rate. */
export const GROWTH_PER_MONTH = 0.05;
export const MAX_GROWTH_MONTHS = 24;

export interface Readiness {
  /** Chance her weighted ability reaches the track's bar by the exam, if she keeps studying. */
  p: number;
  band: "start" | "building" | "on_track";
  theta: number;
  /** Subjects she has measured, out of those the track needs. */
  measured: number;
  needed: number;
  /** The subject where one unit of ability helps this track most (biggest weight × gap). */
  focus: string | null;
}

export function readiness(track: Track, ab: Record<string, Ability>, months: number): Readiness {
  const subs = Object.entries(track.subjects);
  const total = subs.reduce((s, [, w]) => s + w, 0);
  let theta = 0, v = 0, measured = 0;
  for (const [s, w] of subs) {
    const a = ab[s] ?? PRIOR_ABILITY;
    if (a.n > 0) measured++;
    theta += (w / total) * a.theta;
    v += (w / total) ** 2 * a.se ** 2;
  }
  const projected = theta + GROWTH_PER_MONTH * Math.min(Math.max(months, 0), MAX_GROWTH_MONTHS);
  // Logistic approximation of a normal tail: 1.7 makes the two curves almost the same.
  const p = round2(1 / (1 + Math.exp(-1.7 * (projected - track.bar) / Math.sqrt(1 + v))));
  const focus = subs
    .map(([s, w]) => ({ s, gain: w * Math.max(0, track.bar + 0.5 - (ab[s] ?? PRIOR_ABILITY).theta) }))
    .sort((a, b) => b.gain - a.gain || (a.s < b.s ? -1 : 1))[0];
  return {
    p, theta: round2(theta), measured, needed: subs.length,
    band: p >= 0.7 ? "on_track" : p >= 0.35 ? "building" : "start",
    focus: focus && focus.gain > 0 ? focus.s : null,
  };
}

/** Months she has to study before the first entrance or admission on her route. */
export function monthsToExam(start: Start, route: Route | null): number {
  if (!route) return 0;
  let years = start.years;
  for (const e of route.steps) {
    if (e.exams?.length) break;
    years += e.years;
  }
  return Math.round(years * 12);
}

// ---------- study plan (prerequisite-ordered, priority-first) ----------

export interface PlannedTopic { subject: string; topic: string; hours: number; mastery: number }
export interface PlanWeek { week: number; topics: PlannedTopic[]; revision: boolean }
export interface StudyPlan { weeks: PlanWeek[]; skipped: PlannedTopic[]; unplaced: PlannedTopic[] }

/** Share of each week kept for practice questions and revision. */
export const PRACTICE_SHARE = 0.2;
/** A topic she already gets right this often is skipped. */
export const MASTERED = 0.85;

/**
 * Topics she still needs for a track, in an order that respects prerequisites (Kahn's algorithm) and,
 * among the topics that are ready, takes the one with the most value per hour first:
 *     value = subject weight × (1 − chance she already knows it) ÷ hours.
 * Mastery comes from her subject ability and the topic's difficulty (the same 2PL curve as the quiz).
 * Topics are packed into weeks; a long topic carries over into the next week. Weeks after the last topic
 * are revision weeks.
 */
export function studyPlan(pw: Pathways, track: Track, ab: Record<string, Ability>,
  opts: { weeks: number; hoursPerWeek: number }): StudyPlan {
  const topics: (PlannedTopic & { after: string[]; value: number })[] = [];
  const skipped: PlannedTopic[] = [];
  for (const [sid, w] of Object.entries(track.subjects)) {
    const subject = pw.subjects[sid];
    if (!subject) continue;
    const theta = (ab[sid] ?? PRIOR_ABILITY).theta;
    for (const t of subject.topics) {
      const mastery = round2(pCorrect(theta, 1.2, t.b));
      const row = { subject: sid, topic: t.id, hours: t.hours, mastery };
      if (mastery >= MASTERED) skipped.push(row);
      else topics.push({ ...row, after: t.after, value: (w * (1 - mastery)) / t.hours });
    }
  }
  // Kahn's algorithm. Prerequisites she has mastered (or that this track does not use) count as done.
  const pending = new Set(topics.map((t) => t.topic));
  const indeg = new Map(topics.map((t) => [t.topic, t.after.filter((a) => pending.has(a)).length]));
  const ready = topics.filter((t) => indeg.get(t.topic) === 0);
  const order: typeof topics = [];
  while (ready.length) {
    ready.sort((a, b) => b.value - a.value || (a.topic < b.topic ? -1 : 1));
    const t = ready.shift()!;
    order.push(t);
    for (const u of topics) {
      if (!u.after.includes(t.topic)) continue;
      const d = indeg.get(u.topic)! - 1;
      indeg.set(u.topic, d);
      if (d === 0) ready.push(u);
    }
  }

  const capacity = Math.max(1, opts.hoursPerWeek * (1 - PRACTICE_SHARE));
  const weeks: PlanWeek[] = [];
  let week: PlanWeek = { week: 1, topics: [], revision: false };
  let room = capacity;
  const unplaced: PlannedTopic[] = [];
  for (const t of order) {
    let left = t.hours;
    while (left > 0) {
      if (week.week > opts.weeks) break;
      const take = Math.min(left, room);
      week.topics.push({ subject: t.subject, topic: t.topic, hours: round1(take), mastery: t.mastery });
      left -= take;
      room -= take;
      if (room <= 1e-9) {
        weeks.push(week);
        week = { week: week.week + 1, topics: [], revision: false };
        room = capacity;
      }
    }
    if (left > 0) unplaced.push({ subject: t.subject, topic: t.topic, hours: round1(left), mastery: t.mastery });
  }
  if (week.topics.length && week.week <= opts.weeks) weeks.push(week);
  for (let w = weeks.length + 1; w <= opts.weeks; w++) weeks.push({ week: w, topics: [], revision: true });
  return { weeks, skipped, unplaced };
}

// ---------- spaced practice (Leitner boxes) ----------

/** Days until a question comes back, by box. Box 1 is "missed it", box 5 is "knows it well". */
export const LEITNER_DAYS = [1, 2, 4, 8, 16];

export interface Card { box: number; due: number }

/** Move a card after an answer: right goes up a box, wrong goes back to box 1. `day` is a day number. */
export function review(card: Card | undefined, correct: boolean, day: number): Card {
  const box = correct ? Math.min(LEITNER_DAYS.length, (card?.box ?? 0) + 1) : 1;
  return { box, due: day + LEITNER_DAYS[box - 1] };
}

/** Cards due today or earlier, most overdue and lowest box first. */
export function dueCards(cards: Record<string, Card>, day: number): string[] {
  return Object.entries(cards)
    .filter(([, c]) => c.due <= day)
    .sort(([a, x], [b, y]) => x.due - y.due || x.box - y.box || (a < b ? -1 : 1))
    .map(([id]) => id);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
