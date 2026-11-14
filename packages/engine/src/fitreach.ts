// Career matching from measured skill levels (version 2). Keep in step with apps/api/app/services/fitreach.py.
//
//   Fit   = can she do the career's sub-skills now? (chance she is at or above each needed level)
//   Reach = could she get there? (aptitude for the career, how far below the needed levels, education gap)
//   Worth = would she want it? (interest match and local demand)
//   score = 0.4 Fit + 0.35 Reach + 0.25 Worth, then the same variety re-rank as version 1 (mmrRerank).

import { aptitudeNeedsOf, needsOf } from "./graph.ts";
import { EDUCATION_ORDER } from "./kb.ts";
import { mmrRerank, occRiasecVec, studentRiasecVec, type ScoredCareer } from "./matcher.ts";
import { pyRound, pySum } from "./pymath.ts";
import type { KB, Occupation, Persona } from "./types.ts";

export const FRW_WEIGHTS = { fit: 0.4, reach: 0.35, worth: 0.25 };
const REACH_PARTS = { aptitude: 0.4, closeness: 0.3, education: 0.3 };
const WORTH_PARTS = { interest: 0.6, demand: 0.4 };
const DEMAND: Record<string, number> = { high: 1.0, medium: 0.7, low: 0.4 };
/** For a sub-skill with no evidence at all: most students are at level 1 or 2. */
export const UNKNOWN_LEVELS = [0.5, 0.3, 0.15, 0.05];
const UNKNOWN_CREDIT = 0.5;
const MET = 0.6;          // a need counts as met when she is 60%+ likely to be at that level
const COULD_LEARN_APTITUDE = 0.65;

export interface PersonaV2 {
  education?: string;
  riasec?: Persona["riasec"];
  /** sub-skill (or whole-skill) id -> chances of levels 1-4, from foldEvents */
  levels: Record<string, number[]>;
  /** aptitude id -> ability on the same scale as tests (0 = average) */
  aptitude?: Record<string, { theta: number; se?: number }>;
}

export interface CareerV2 extends ScoredCareer {
  /** sub-skills she already meets for this career */
  met: string[];
  /** sub-skills still below the needed level, most important first */
  gaps: string[];
  /** strong aptitude for a career she can't do yet */
  could_learn: boolean;
}

export interface WhatIfV2 {
  lever: string; // "subskill:<id>" (reach level 3) or "education:<level>"
  unlocks: string[];
}

function atLeast(p: number[], level: number): number {
  let s = 0;
  for (let L = level - 1; L < 4; L++) s += p[L];
  return s;
}

function cosine(a: number[], b: number[]): number {
  const na = Math.sqrt(pySum(a.map((x) => x * x)));
  const nb = Math.sqrt(pySum(b.map((x) => x * x)));
  return na === 0 || nb === 0 ? 0 : pySum(a.map((x, i) => x * b[i])) / (na * nb);
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function scoreOne(kb: KB, occ: Occupation, persona: PersonaV2): CareerV2 {
  const g = kb.graph!;
  const needs = needsOf(g, occ.id);
  const wTotal = pySum(needs.map((n) => n.weight));
  let fit = 0;
  let shortfall = 0;
  const met: string[] = [];
  const gaps: { id: string; w: number }[] = [];
  for (const n of needs) {
    const known = persona.levels[n.id];
    const p = known ?? UNKNOWN_LEVELS;
    // No evidence at all counts half: an untested sub-skill must not look as good as a shown one.
    const ok = atLeast(p, n.level) * (known ? 1 : UNKNOWN_CREDIT);
    fit += n.weight * ok;
    let short = 0;
    for (let L = 1; L <= 4; L++) short += p[L - 1] * Math.max(0, n.level - L);
    shortfall += n.weight * (short / 3);
    if (ok >= MET) met.push(n.id);
    else gaps.push({ id: n.id, w: n.weight * (1 - ok) });
  }
  fit = wTotal ? fit / wTotal : 0;
  const closeness = wTotal ? 1 - shortfall / wTotal : 0;

  const aptNeeds = aptitudeNeedsOf(g, occ.id);
  const aTotal = pySum(aptNeeds.map((a) => a.weight));
  let apt = 0;
  let aptKnown = false;
  for (const a of aptNeeds) {
    const known = persona.aptitude?.[a.id];
    if (known) aptKnown = true;
    apt += a.weight * (known ? sigmoid(1.2 * known.theta) : 0.5);
  }
  apt = aTotal ? apt / aTotal : 0.5;
  const eduGap = Math.max(0, EDUCATION_ORDER[occ.min_education] - (EDUCATION_ORDER[persona.education ?? "class10"] ?? 0));
  const education = 1 / (1 + eduGap);
  const reach = REACH_PARTS.aptitude * apt + REACH_PARTS.closeness * closeness + REACH_PARTS.education * education;

  const interest = cosine(studentRiasecVec({ riasec: persona.riasec }), occRiasecVec(occ.riasec));
  const demand = DEMAND[occ.local_demand_tn ?? "medium"] ?? 0.7;
  const worth = WORTH_PARTS.interest * interest + WORTH_PARTS.demand * demand;

  const total = FRW_WEIGHTS.fit * fit + FRW_WEIGHTS.reach * reach + FRW_WEIGHTS.worth * worth;
  gaps.sort((x, y) => y.w - x.w);
  return {
    occupation_id: occ.id,
    sector: occ.sector,
    score: pyRound(total, 4),
    parts: { fit: pyRound(fit, 3), reach: pyRound(reach, 3), worth: pyRound(worth, 3), aptitude: pyRound(apt, 3) },
    matched_skills: [...new Set(met.map((id) => g.subskills[id]?.skill ?? id))],
    met,
    gaps: gaps.map((x) => x.id),
    could_learn: aptKnown && apt >= COULD_LEARN_APTITUDE && fit < 0.5,
  };
}

export function scoreAllV2(kb: KB, persona: PersonaV2): CareerV2[] {
  const out = Object.values(kb.occupations).map((occ) => scoreOne(kb, occ, persona));
  out.sort((a, b) => b.score - a.score); // stable, like Python
  return out;
}

/** Which careers would enter her list if she reached level 3 in one sub-skill, or one more education level. */
export function whatIfV2(kb: KB, persona: PersonaV2, k = 8, maxLevers = 4): WhatIfV2[] {
  const ranked = mmrRerank(kb, scoreAllV2(kb, persona), k) as CareerV2[];
  const base = new Set(ranked.map((r) => r.occupation_id));
  const levers: [string, PersonaV2][] = [];
  const current = EDUCATION_ORDER[persona.education ?? "class10"] ?? 0;
  const higher = Object.entries(EDUCATION_ORDER).sort((a, b) => a[1] - b[1]).filter(([, v]) => v > current).map(([e]) => e);
  if (higher.length) levers.push([`education:${higher[0]}`, { ...persona, education: higher[0] }]);
  // Sub-skills that hold back careers just outside her list.
  const pull = new Map<string, number>();
  for (const c of scoreAllV2(kb, persona)) {
    if (base.has(c.occupation_id)) continue;
    for (const n of needsOf(kb.graph!, c.occupation_id)) {
      if (!c.gaps.includes(n.id)) continue;
      pull.set(n.id, (pull.get(n.id) ?? 0) + n.weight * c.score);
    }
  }
  const top = [...pull.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, maxLevers);
  for (const [id] of top) levers.push([`subskill:${id}`, { ...persona, levels: { ...persona.levels, [id]: [0, 0, 1, 0] } }]);
  const out: WhatIfV2[] = [];
  for (const [lever, hypo] of levers) {
    const next = mmrRerank(kb, scoreAllV2(kb, hypo), k).map((r) => r.occupation_id);
    const unlocks = next.filter((o) => !base.has(o));
    if (unlocks.length) out.push({ lever, unlocks });
  }
  return out;
}

export function recommendV2(kb: KB, persona: PersonaV2, k = 8) {
  return { careers: mmrRerank(kb, scoreAllV2(kb, persona), k) as CareerV2[], what_if: whatIfV2(kb, persona, k) };
}

/** Builds the matching input from a folded profile (foldEvents) plus education and interests. */
export function personaFromProfile(profile: { units: Record<string, { p: number[]; n: number }>; aptitude: Record<string, { theta: number; se: number }> },
  extra: { education?: string; riasec?: Persona["riasec"] }): PersonaV2 {
  const levels: Record<string, number[]> = {};
  for (const [id, u] of Object.entries(profile.units)) levels[id] = u.p;
  return { ...extra, levels, aptitude: profile.aptitude };
}

/**
 * Which sub-skills are worth testing next: for each candidate, imagine each possible level (weighted by how
 * likely it is now) and count how much her top-5 careers would change. A sub-skill no career cares about scores 0.
 */
export function nextToTest(kb: KB, persona: PersonaV2, candidates: string[], n = 3): { id: string; value: number }[] {
  const top5 = (p: PersonaV2) => new Set(scoreAllV2(kb, p).slice(0, 5).map((c) => c.occupation_id));
  const now = top5(persona);
  const out: { id: string; value: number }[] = [];
  for (const id of candidates) {
    const p = persona.levels[id] ?? UNKNOWN_LEVELS;
    let value = 0;
    for (let L = 0; L < 4; L++) {
      if (p[L] < 0.01) continue;
      const hypo = top5({ ...persona, levels: { ...persona.levels, [id]: [0, 1, 2, 3].map((k) => (k === L ? 1 : 0)) } });
      let changed = 0;
      for (const o of hypo) if (!now.has(o)) changed++;
      value += p[L] * (changed / 5);
    }
    // An unsure level is worth checking even when the list would not move much.
    const unsure = 1 - Math.max(...p);
    out.push({ id, value: value + 0.1 * unsure });
  }
  return out.sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1)).slice(0, n);
}
