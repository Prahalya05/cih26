// Career matching, a copy of apps/api/app/services/matcher.py:
// transparent hybrid score -> MMR diversity re-rank with sector quota -> what-if unlocks.
//
// score = w_embed*embed_sim + w_skill*skill_overlap + w_riasec*riasec_fit + w_feas*feasibility
// If no embedding similarities are supplied, w_embed is shared out over the other terms.

import { EDUCATION_ORDER } from "./kb.ts";
import { pyRound, pySum } from "./pymath.ts";
import type { KB, Occupation, Persona } from "./types.ts";

export const WEIGHTS = { embed: 0.35, skill: 0.3, riasec: 0.2, feas: 0.15 };
const RIASEC = "RIASEC";
const DEMAND: Record<string, number> = { high: 1.0, medium: 0.7, low: 0.4 };
const ADJACENT_CREDIT = 0.5; // partial credit for a skill in the same cluster as one the student has

export interface ScoredCareer {
  occupation_id: string;
  sector: string;
  score: number;
  parts: Record<string, number>;
  matched_skills: string[];
}

export interface WhatIf {
  lever: string;
  unlocks: string[];
}

function cos(a: number[], b: number[]): number {
  const na = Math.sqrt(pySum(a.map((x) => x * x)));
  const nb = Math.sqrt(pySum(b.map((x) => x * x)));
  const n = Math.min(a.length, b.length);
  return na === 0 || nb === 0 ? 0 : pySum(a.slice(0, n).map((x, i) => x * b[i])) / (na * nb);
}

export function occRiasecVec(code: string): number[] {
  const weights = [1.0, 0.66, 0.33];
  const vec = [0, 0, 0, 0, 0, 0];
  [...code.slice(0, 3)].forEach((letter, i) => { vec[RIASEC.indexOf(letter)] = weights[i]; });
  return vec;
}

export function studentRiasecVec(persona: Persona): number[] {
  const r = (persona.riasec ?? {}) as Record<string, number>;
  return [...RIASEC].map((letter) => Number(r[letter] ?? 0));
}

function skillConf(persona: Persona): Map<string, number> {
  const conf = new Map<string, number>();
  for (const s of persona.skills ?? []) conf.set(s.id, Number(s.confidence ?? 0.6));
  return conf;
}

export function skillOverlap(kb: KB, occ: Occupation, conf: Map<string, number>): [number, string[]] {
  const clusterBest = new Map<string, number>();
  for (const [sid, c] of conf) {
    const cl = kb.skills[sid]?.cluster;
    if (cl) clusterBest.set(cl, Math.max(clusterBest.get(cl) ?? 0, c));
  }
  const total = pySum(occ.skills.map((s) => s.w));
  let got = 0;
  const matched: string[] = [];
  for (const s of occ.skills) {
    if (conf.has(s.id)) {
      got += s.w * conf.get(s.id)!;
      matched.push(s.id);
    } else {
      const cl = kb.skills[s.id]?.cluster;
      got += s.w * ADJACENT_CREDIT * (cl ? clusterBest.get(cl) ?? 0 : 0);
    }
  }
  return [total ? got / total : 0, matched];
}

export function feasibility(occ: Occupation, education: string): number {
  const gap = Math.max(0, EDUCATION_ORDER[occ.min_education] - (EDUCATION_ORDER[education] ?? 0));
  return 0.7 * (1.0 / (1 + gap)) + 0.3 * (DEMAND[occ.local_demand_tn ?? "medium"] ?? 0.7);
}

export function scoreAll(kb: KB, persona: Persona, embedSims?: Record<string, number> | null): ScoredCareer[] {
  let w: Record<string, number> = { ...WEIGHTS };
  const useEmbed = !!embedSims && Object.keys(embedSims).length > 0;
  if (!useEmbed) {
    const extra = w.embed;
    delete w.embed;
    const rest = pySum(Object.values(w));
    w = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v + (extra * v) / rest]));
  }
  const conf = skillConf(persona);
  const svec = studentRiasecVec(persona);
  const edu = persona.education ?? "class10";
  const out: ScoredCareer[] = [];
  for (const occ of Object.values(kb.occupations)) {
    const [sk, matched] = skillOverlap(kb, occ, conf);
    const parts: Record<string, number> = {
      skill: sk,
      riasec: cos(svec, occRiasecVec(occ.riasec)),
      feas: feasibility(occ, edu),
    };
    if (useEmbed) parts.embed = Number(embedSims![occ.id] ?? 0);
    const total = pySum(Object.keys(parts).map((k) => w[k] * parts[k]));
    out.push({
      occupation_id: occ.id,
      sector: occ.sector,
      score: pyRound(total, 4),
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, pyRound(v, 3)])),
      matched_skills: matched,
    });
  }
  out.sort((a, b) => b.score - a.score); // stable, like Python
  return out;
}

/** Python max(): the first item with the highest key wins. */
function firstMax<T>(items: T[], key: (item: T) => number): T {
  let best = items[0];
  let bestKey = key(best);
  for (const item of items.slice(1)) {
    const k = key(item);
    if (k > bestKey) { best = item; bestKey = k; }
  }
  return best;
}

export function mmrRerank(kb: KB, scored: ScoredCareer[], k = 8, lam = 0.7, minSectors = 4): ScoredCareer[] {
  const occs = kb.occupations;
  const pool = [...scored];
  const picked: ScoredCareer[] = [];
  while (pool.length && picked.length < k) {
    const sectors = new Set(picked.map((p) => p.sector));
    const needNew = minSectors - sectors.size;
    let cand = pool;
    if (needNew > 0 && k - picked.length <= needNew) {
      const fresh = pool.filter((c) => !sectors.has(c.sector));
      cand = fresh.length ? fresh : pool;
    }
    const mmr = (c: ScoredCareer): number => {
      if (!picked.length) return c.score;
      const red = Math.max(...picked.map((p) =>
        p.sector === c.sector ? 1.0 : 0.5 * cos(
          occRiasecVec(occs[p.occupation_id].riasec),
          occRiasecVec(occs[c.occupation_id].riasec))));
      return lam * c.score - (1 - lam) * red;
    };
    const best = firstMax(cand, mmr);
    picked.push(best);
    pool.splice(pool.indexOf(best), 1);
  }
  return picked;
}

/** Counterfactual unlocks: which careers enter the top-k if the student adds one skill or one education level. */
export function whatIf(kb: KB, persona: Persona, k = 8, maxLevers = 4): WhatIf[] {
  const base = new Set(mmrRerank(kb, scoreAll(kb, persona), k).map((r) => r.occupation_id));
  const levers: [string, Persona][] = [];
  const edu = persona.education ?? "class10";
  const current = EDUCATION_ORDER[edu] ?? 0;
  const higher = Object.entries(EDUCATION_ORDER)
    .sort((a, b) => a[1] - b[1])
    .filter(([, v]) => v > current)
    .map(([e]) => e);
  if (higher.length) {
    levers.push([`education:${higher[0]}`, { ...persona, education: higher[0] }]);
    if (higher.includes("class12") && higher[0] !== "class12") {
      levers.push(["education:class12", { ...persona, education: "class12" }]);
    }
  }
  const have = new Set((persona.skills ?? []).map((s) => s.id));
  const missing = new Map<string, number>();
  for (const occ of Object.values(kb.occupations)) {
    for (const s of occ.skills) {
      if (!have.has(s.id)) missing.set(s.id, (missing.get(s.id) ?? 0) + s.w);
    }
  }
  const topMissing = [...missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxLevers);
  for (const [sid] of topMissing) {
    levers.push([`skill:${sid}`, { ...persona, skills: [...(persona.skills ?? []), { id: sid, confidence: 0.7 }] }]);
  }
  const results: WhatIf[] = [];
  for (const [name, hypo] of levers) {
    const next = mmrRerank(kb, scoreAll(kb, hypo), k).map((r) => r.occupation_id);
    const unlocks = next.filter((o) => !base.has(o));
    if (unlocks.length) results.push({ lever: name, unlocks });
  }
  return results;
}

export function recommend(kb: KB, persona: Persona, k = 8, embedSims?: Record<string, number> | null) {
  return { careers: mmrRerank(kb, scoreAll(kb, persona, embedSims), k), what_if: whatIf(kb, persona, k) };
}
