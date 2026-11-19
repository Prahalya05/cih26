// Turns a student's evidence events into a level (1-4) with a confidence for every sub-skill.
// Pure and deterministic: the same events, graph and "now" always give the same result.
// Keep in step with apps/api/app/services/tracing.py (checked by golden tests).
//
// How it works, in short:
//   - Each sub-skill holds four probabilities, one per level, starting at PRIOR.
//   - Every piece of evidence has a likelihood: how likely that result is at each level.
//   - Evidence is weighed by raising its likelihood to (weight x age factor x rater reliability):
//       posterior ∝ prior × Π likelihood(e | level) ^ weight(e)
//     so a self-report (0.5) moves the estimate gently and a paid order (5) moves it a lot.
//   - Between pieces of evidence some probability moves up a level each week (she keeps learning).
//   - Performance evidence spreads a little to related sub-skills through the graph.

import { relatedOf, subskillsOf, type Graph } from "./graph.ts";
import { eap, levelLikelihood, prior, se, update, type ItemParams } from "./irt.ts";
import type { EvidenceEvent } from "./events.ts";

export const PRIOR = [0.4, 0.3, 0.2, 0.1];
const DAY = 86_400_000;

export const EVIDENCE_WEIGHTS = {
  self_report: 0.5,
  family_report: 0.75,
  endorse: 2,
  item_group: 0.7,        // a test session; uncalibrated questions count a little less (raise after pilot calibration)
  task: 2,
  work_sample_ai: 3,
  work_sample_teacher: 4,
  rating_level: 3,
  taster: 4,
  order_unconfirmed: 1,
  order_confirmed: 2,
};
export const MAX_CONFIRMED_ORDERS = 5;  // up to 10 in total, then more orders add nothing
const HALF_LIFE_DAYS = { said: 365, shown: 730 };
const LEARN_PER_WEEK = 0.05;
const LEARN_MAX = 0.2;
const SPREAD_HOP1 = 0.5;
const SPREAD_HOP2 = 0.25;
export const STRONG_CONFIDENCE = 0.8;
/** AI-scored work samples count as this rater, so their weight follows the AI's agreement with teachers. */
export const AI_RATER = "ai_vision";
const MAX_HISTORY = 20;

const SAID = [0.1, 0.3, 0.35, 0.25];
const ENDORSE = [0.05, 0.25, 0.4, 0.3];
const ORDER_UNCONFIRMED = [0.1, 0.3, 0.4, 0.3];
const ORDER_GOOD = [0.02, 0.15, 0.5, 0.6];
const ORDER_OK = [0.05, 0.25, 0.5, 0.4];
const ORDER_POOR = [0.2, 0.4, 0.3, 0.1];
// Tests, tasks and photos cannot tell level 3 from level 4: only paid work shows earning.
const TASK_MU = [0.2, 0.5, 0.8, 0.8];
const WORK_MU = [0.15, 0.45, 0.8, 0.8];
const SCORE_SD = 0.4;
const LEVEL4_CAP_UNPAID = 0.4;

const gauss = (x: number, mus: number[], sd: number) => mus.map((m) => Math.exp(-0.5 * ((x - m) / sd) ** 2));
const peaked = (level: number) => [0, 1, 2, 3].map((k) => (k === level - 1 ? 0.6 : Math.abs(k - (level - 1)) === 1 ? 0.25 : 0.05));

export interface Rubric {
  id: string;
  skill: string;
  criteria: { id: string; subskill?: string }[];
}

export interface TraceOptions {
  now: number;
  items?: Record<string, ItemParams>;
  rubrics?: Record<string, Rubric>;
  /** rater id -> weight multiplier (from rater reliability), default 1, floor 0.3 */
  raterWeights?: Record<string, number>;
}

export interface Change {
  event_id: string;
  kind: string;
  at: number;
  level_before: number;
  level_after: number;
  confidence_after: number;
}

export interface UnitState {
  id: string;            // sub-skill id, or a skill id for skills without sub-skills
  p: number[];           // chances of levels 1-4
  level: number;         // highest level she is at least at with 50%+ chance
  confidence: number;    // chance she is at least at that level
  strong: boolean;       // level 3+ with 80%+ confidence, backed by performance evidence
  performance: boolean;  // has evidence from a test, task, work sample, taster, rating or order
  paid: boolean;         // has a buyer-confirmed paid order
  n: number;             // number of direct pieces of evidence
  last_at: number;
  history: Change[];
}

export interface AptitudeState {
  theta: number;
  se: number;
  n: number;
}

export interface Profile {
  units: Record<string, UnitState>;
  aptitude: Record<string, AptitudeState>;
}

interface Piece {
  at: number;
  event_id: string;
  kind: string;
  units: string[];
  lik: number[];
  weight: number;           // before age and rater factors
  said: boolean;            // self or family report: shorter half-life
  rater?: string;
  shown: boolean;           // performance evidence (task, sample, taster, rating, confirmed order): can make Strong
  spreads?: boolean;        // test answers also spread to related sub-skills, without making Strong
  paid?: boolean;
  /** For corrections: the likelihood and weight to divide out (an AI score replaced by a teacher's). */
  undo?: { lik: number[]; weight: number; at: number; rater?: string };
}

// ---------- helpers ----------

export function displayLevel(p: number[]): { level: number; confidence: number } {
  let atLeast = 0;
  for (let L = 3; L >= 0; L--) {
    atLeast += p[L];
    if (atLeast >= 0.5) return { level: L + 1, confidence: atLeast };
  }
  return { level: 1, confidence: 1 };
}

function normalise(p: number[]): number[] {
  const s = p[0] + p[1] + p[2] + p[3];
  return p.map((x) => x / s);
}

function temper(p: number[], lik: number[], w: number): number[] {
  return normalise(p.map((x, L) => x * Math.pow(Math.max(lik[L], 1e-12), w)));
}

function learn(p: number[], weeks: number): number[] {
  const f = Math.min(LEARN_PER_WEEK * weeks, LEARN_MAX);
  if (f <= 0) return p;
  return [p[0] * (1 - f), p[1] * (1 - f) + p[0] * f, p[2] * (1 - f) + p[1] * f, p[3] + p[2] * f];
}

/** Spread evidence only tells "below level 2 or not"; it can never lift a sub-skill past level 2 alone. */
const flatten = (lik: number[]) => [lik[0], lik[1], lik[1], lik[1]];

function ageFactor(at: number, now: number, said: boolean): number {
  const days = Math.max(0, (now - at) / DAY);
  return Math.pow(0.5, days / (said ? HALF_LIFE_DAYS.said : HALF_LIFE_DAYS.shown));
}

function targets(g: Graph, e: { subskill_id?: string; skill_id?: string }): string[] {
  if (e.subskill_id) return [e.subskill_id];
  if (e.skill_id) {
    const subs = subskillsOf(g, e.skill_id);
    return subs.length ? subs : [e.skill_id];
  }
  return [];
}

const byTime = (a: { created_at: number; id: string }, b: { created_at: number; id: string }) =>
  a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const utcDay = (t: number) => Math.floor(t / DAY);

function itemOf(e: EvidenceEvent, items: Record<string, ItemParams> | undefined): ItemParams {
  const known = e.item_id ? items?.[e.item_id] : undefined;
  if (known) return known;
  const p = e.payload as { a?: number; b?: number };
  return { id: e.item_id ?? "?", a: typeof p.a === "number" ? p.a : 1, b: typeof p.b === "number" ? p.b : 0 };
}

function cutsOf(g: Graph, unit: string): number[] {
  return g.subskills[unit]?.cuts ?? [-1, 0.3, 1.5];
}

/** Work-sample scores (0-2 per criterion) grouped into one 0-1 score per sub-skill. */
function sampleScores(g: Graph, skill: string, scores: Record<string, number>, rubric: Rubric | undefined): [string[], number][] {
  const groups = new Map<string, number[]>();
  const all = subskillsOf(g, skill);
  const fallback = all.length ? all : [skill];
  for (const [crit, s] of Object.entries(scores)) {
    const sub = rubric?.criteria.find((c) => c.id === crit)?.subskill;
    const key = sub ?? "*";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const out: [string[], number][] = [];
  for (const [key, list] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const avg = list.reduce((x, y) => x + y, 0) / list.length / 2;
    out.push([key === "*" ? fallback : [key], avg]);
  }
  return out;
}

// ---------- turning events into weighted pieces of evidence ----------

function evidencePieces(events: EvidenceEvent[], g: Graph, opts: TraceOptions): Piece[] {
  const sorted = [...events].sort(byTime);
  const pieces: Piece[] = [];

  // Tap self-reports can be taken back; a later "retracted" cancels the matching earlier one.
  const cancelled = new Set<string>();
  const openTaps = new Map<string, string[]>();
  for (const e of sorted) {
    if (e.kind !== "self_report" || e.payload.source !== "tap") continue;
    const key = `${e.subskill_id ?? e.skill_id}|${e.payload.qid ?? ""}`;
    const list = openTaps.get(key) ?? [];
    if (e.payload.retracted === true) {
      const last = list.pop();
      if (last) cancelled.add(last);
      cancelled.add(e.id);
    } else list.push(e.id);
    openTaps.set(key, list);
  }

  // Confirmations point at the event they confirm.
  const confirmations = new Map<string, EvidenceEvent>();
  for (const e of sorted) if (e.kind === "rating" && e.refers_to) confirmations.set(e.refers_to, e);
  const byId = new Map(sorted.map((e) => [e.id, e]));

  // Test answers are grouped per sub-skill per day, so answers in one session are judged together.
  const itemGroups = new Map<string, EvidenceEvent[]>();
  for (const e of sorted) {
    if (e.kind !== "item_response" || !e.subskill_id) continue;
    const key = `${e.subskill_id}|${utcDay(e.created_at)}`;
    if (!itemGroups.has(key)) itemGroups.set(key, []);
    itemGroups.get(key)!.push(e);
  }
  const groupEnd = new Map<string, string>(); // last event id of each group -> group key
  for (const [key, list] of itemGroups) groupEnd.set(list[list.length - 1].id, key);

  const confirmedOrders = new Map<string, number>();

  for (const e of sorted) {
    const p = e.payload as Record<string, unknown>;
    const base = { at: e.created_at, event_id: e.id, kind: e.kind };
    switch (e.kind) {
      case "self_report":
      case "family_report": {
        if (cancelled.has(e.id)) break;
        const said = e.kind === "self_report";
        pieces.push({ ...base, units: targets(g, e), lik: SAID, weight: said ? EVIDENCE_WEIGHTS.self_report : EVIDENCE_WEIGHTS.family_report,
          said: true, shown: false });
        break;
      }
      case "item_response": {
        const key = groupEnd.get(e.id);
        if (!key) break;
        const unit = e.subskill_id!;
        const answers = itemGroups.get(key)!.map((x) => ({ item: itemOf(x, opts.items), correct: x.payload.correct === true }));
        const lik = levelLikelihood(answers, cutsOf(g, unit));
        pieces.push({ ...base, kind: "test", units: [unit], lik: [lik[0], lik[1], lik[2], lik[2]],
          weight: EVIDENCE_WEIGHTS.item_group, said: false, shown: false, spreads: true });
        break;
      }
      case "task":
        pieces.push({ ...base, units: targets(g, e), lik: gauss(Number(p.score), TASK_MU, SCORE_SD), weight: EVIDENCE_WEIGHTS.task,
          said: false, shown: true });
        break;
      case "work_sample": {
        if (p.scorer === "pending" || !e.skill_id) break;
        const rubric = opts.rubrics?.[String(p.rubric_id)];
        const w = p.scorer === "teacher" ? EVIDENCE_WEIGHTS.work_sample_teacher : EVIDENCE_WEIGHTS.work_sample_ai;
        const rater = p.scorer === "ai" ? AI_RATER : undefined;
        for (const [units, s] of sampleScores(g, e.skill_id, p.scores as Record<string, number>, rubric)) {
          pieces.push({ ...base, units, lik: gauss(s, WORK_MU, SCORE_SD), weight: w, said: false, shown: true, rater });
        }
        break;
      }
      case "rating": {
        if (e.refers_to) {
          const target = byId.get(e.refers_to);
          if (!target || confirmations.get(e.refers_to)?.id !== e.id) break; // only the latest confirmation counts
          if (target.kind === "work_sample" && target.skill_id && p.scores) {
            const tp = target.payload as Record<string, unknown>;
            const rubric = opts.rubrics?.[String(tp.rubric_id)];
            const before = tp.scorer === "pending" ? null : sampleScores(g, target.skill_id, tp.scores as Record<string, number>, rubric);
            const beforeW = tp.scorer === "teacher" ? EVIDENCE_WEIGHTS.work_sample_teacher : EVIDENCE_WEIGHTS.work_sample_ai;
            for (const [units, s] of sampleScores(g, target.skill_id, p.scores as Record<string, number>, rubric)) {
              const old = before?.find(([u]) => u.join() === units.join());
              pieces.push({ ...base, kind: "confirmation", units, lik: gauss(s, WORK_MU, SCORE_SD), weight: EVIDENCE_WEIGHTS.work_sample_teacher,
                said: false, rater: e.rater_id, shown: true,
                undo: old ? { lik: gauss(old[1], WORK_MU, SCORE_SD), weight: beforeW, at: target.created_at,
                  rater: tp.scorer === "ai" ? AI_RATER : undefined } : undefined });
            }
          } else if (target.kind === "order" && target.skill_id) {
            const units = targets(g, target);
            const key = units.join();
            const n = confirmedOrders.get(key) ?? 0;
            const good = p.quality === true;
            const lik = good && p.rehire === true ? ORDER_GOOD : good ? ORDER_OK : ORDER_POOR;
            const weight = n < MAX_CONFIRMED_ORDERS ? EVIDENCE_WEIGHTS.order_confirmed : 0;
            confirmedOrders.set(key, n + 1);
            pieces.push({ ...base, kind: "order_confirmed", units, lik, weight, said: false, shown: true, paid: true,
              undo: { lik: ORDER_UNCONFIRMED, weight: EVIDENCE_WEIGHTS.order_unconfirmed, at: target.created_at } });
          }
          break;
        }
        const units = targets(g, e);
        if (typeof p.level === "number") {
          pieces.push({ ...base, units, lik: peaked(p.level), weight: EVIDENCE_WEIGHTS.rating_level, said: false, rater: e.rater_id, shown: true });
        } else if (p.endorse === true) {
          pieces.push({ ...base, kind: "endorse", units, lik: ENDORSE, weight: EVIDENCE_WEIGHTS.endorse, said: false, rater: e.rater_id, shown: false });
        }
        break;
      }
      case "taster": {
        const levels = p.levels as Record<string, number>;
        for (const unit of Object.keys(levels).sort()) {
          pieces.push({ ...base, units: [unit], lik: peaked(levels[unit]), weight: EVIDENCE_WEIGHTS.taster, said: false, rater: e.rater_id, shown: true });
        }
        break;
      }
      case "order":
        pieces.push({ ...base, units: targets(g, e), lik: ORDER_UNCONFIRMED, weight: EVIDENCE_WEIGHTS.order_unconfirmed, said: false, shown: false });
        break;
    }
  }
  return pieces;
}

// ---------- folding ----------

function newUnit(id: string): UnitState {
  return { id, p: [...PRIOR], level: 1, confidence: 1, strong: false, performance: false, paid: false, n: 0, last_at: 0, history: [] };
}

function finish(u: UnitState): UnitState {
  let p = u.p;
  // Only buyer-confirmed paid work can make level 4 likely.
  if (!u.paid && p[3] > LEVEL4_CAP_UNPAID) p = [p[0], p[1], p[2] + p[3] - LEVEL4_CAP_UNPAID, LEVEL4_CAP_UNPAID];
  const { level, confidence } = displayLevel(p);
  const strong = level >= 3 && p[2] + p[3] >= STRONG_CONFIDENCE && u.performance;
  return { ...u, p, level, confidence, strong };
}

/** Rebuilds every sub-skill's level and every aptitude from the student's events. */
export function foldEvents(events: EvidenceEvent[], g: Graph, opts: TraceOptions): Profile {
  const units: Record<string, UnitState> = {};
  const get = (id: string) => (units[id] ??= newUnit(id));
  const raterW = (r?: string) => (r ? Math.max(0.3, opts.raterWeights?.[r] ?? 1) : 1);

  for (const piece of evidencePieces(events, g, opts)) {
    const w = piece.weight * ageFactor(piece.at, opts.now, piece.said) * raterW(piece.rater);
    for (const id of piece.units) {
      const u = get(id);
      const before = finish(u);
      if (u.last_at > 0) u.p = learn(u.p, (piece.at - u.last_at) / (7 * DAY));
      if (piece.undo) {
        const wu = piece.undo.weight * ageFactor(piece.undo.at, opts.now, false) * raterW(piece.undo.rater);
        u.p = temper(u.p, piece.undo.lik, -wu);
      }
      u.p = temper(u.p, piece.lik, w);
      u.last_at = piece.at;
      u.n += 1;
      if (piece.shown) u.performance = true;
      if (piece.paid) u.paid = true;
      const after = finish(u);
      u.history.push({ event_id: piece.event_id, kind: piece.kind, at: piece.at, level_before: before.level,
        level_after: after.level, confidence_after: after.confidence });
      if (u.history.length > MAX_HISTORY) u.history.shift();

      if (!(piece.shown || piece.spreads) || piece.undo) continue; // a correction's strength already spread with the original
      // Spread to related sub-skills: one hop at half strength, two hops at a quarter.
      const flat = flatten(piece.lik);
      const hop1 = relatedOf(g, id);
      const reached = new Set([id, ...hop1.map((r) => r.id)]);
      for (const r of hop1) {
        const v = get(r.id);
        v.p = temper(v.p, flat, w * r.weight * SPREAD_HOP1);
      }
      for (const r of hop1) {
        for (const r2 of relatedOf(g, r.id)) {
          if (reached.has(r2.id)) continue;
          const v = get(r2.id);
          v.p = temper(v.p, flat, w * r.weight * r2.weight * SPREAD_HOP2);
        }
      }
    }
  }

  const out: Record<string, UnitState> = {};
  for (const id of Object.keys(units).sort()) out[id] = finish(units[id]);
  return { units: out, aptitude: foldAptitude(events, opts) };
}

function foldAptitude(events: EvidenceEvent[], opts: TraceOptions): Record<string, AptitudeState> {
  const posts = new Map<string, { post: number[]; n: number }>();
  for (const e of [...events].sort(byTime)) {
    if (e.kind !== "aptitude_response") continue;
    const domain = String(e.payload.domain);
    const cur = posts.get(domain) ?? { post: prior(0, 1), n: 0 };
    cur.post = update(cur.post, itemOf(e, opts.items), e.payload.correct === true);
    cur.n += 1;
    posts.set(domain, cur);
  }
  const out: Record<string, AptitudeState> = {};
  for (const d of [...posts.keys()].sort()) {
    const { post, n } = posts.get(d)!;
    out[d] = { theta: eap(post), se: se(post), n };
  }
  return out;
}

