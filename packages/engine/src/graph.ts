// The livelihood knowledge graph: sub-skills, aptitudes and the weighted links between them and careers.
// Built from packages/kb/graph/*.json. Keep in step with apps/api/app/kb.py (graph()).

import type { Lang } from "./types.ts";

export type Level = 1 | 2 | 3 | 4;

export interface Subskill {
  id: string;
  skill: string;
  name: Lang;
  levels: Record<"1" | "2" | "3" | "4", { en: string; ta?: string | null }>;
  /** Three ability values that split levels 1|2, 2|3 and 3|4. */
  cuts: [number, number, number];
  cuts_source?: string;
  hazardous_under_18: boolean;
  nqr_ref?: string | null;
}

export interface Aptitude {
  id: string;
  name: Lang;
  games?: string[];
}

export interface Edge {
  src: string;
  dst: string;
  type: "NEEDS" | "NEEDS_APTITUDE" | "RELATED";
  weight: number;
  level?: Level;
  source?: string;
}

export interface Need {
  id: string; // sub-skill id, or a whole-skill id for skills without sub-skills
  level: Level;
  weight: number;
}

export interface Graph {
  subskills: Record<string, Subskill>;
  aptitudes: Record<string, Aptitude>;
  /** skill id -> its sub-skill ids, in file order */
  bySkill: Record<string, string[]>;
  /** occupation id -> what it needs, in file order */
  needs: Record<string, Need[]>;
  /** occupation id -> aptitude weights, in file order */
  aptitudeNeeds: Record<string, { id: string; weight: number }[]>;
  /** sub-skill id -> related sub-skills (both directions), in file order */
  related: Record<string, { id: string; weight: number }[]>;
}

export interface RawGraph {
  subskills: Subskill[];
  aptitudes: Aptitude[];
  edges: Edge[];
}

export function loadGraph(raw: RawGraph): Graph {
  const g: Graph = { subskills: {}, aptitudes: {}, bySkill: {}, needs: {}, aptitudeNeeds: {}, related: {} };
  for (const s of raw.subskills) {
    g.subskills[s.id] = s;
    (g.bySkill[s.skill] ??= []).push(s.id);
    g.related[s.id] = [];
  }
  for (const a of raw.aptitudes) g.aptitudes[a.id] = a;
  for (const e of raw.edges) {
    if (e.type === "NEEDS") {
      (g.needs[e.src] ??= []).push({ id: e.dst, level: (e.level ?? 2) as Level, weight: e.weight });
    } else if (e.type === "NEEDS_APTITUDE") {
      (g.aptitudeNeeds[e.src] ??= []).push({ id: e.dst, weight: e.weight });
    } else {
      g.related[e.src].push({ id: e.dst, weight: e.weight });
      g.related[e.dst].push({ id: e.src, weight: e.weight });
    }
  }
  return g;
}

export const subskillsOf = (g: Graph, skillId: string): string[] => g.bySkill[skillId] ?? [];
export const needsOf = (g: Graph, occId: string): Need[] => g.needs[occId] ?? [];
export const aptitudeNeedsOf = (g: Graph, occId: string) => g.aptitudeNeeds[occId] ?? [];
export const relatedOf = (g: Graph, subskillId: string) => g.related[subskillId] ?? [];
/** The skill a sub-skill belongs to, or the id itself if it is already a skill. */
export const skillOf = (g: Graph, id: string): string => g.subskills[id]?.skill ?? id;
