// Builds the knowledge base object from the raw JSON files.
// The engine never reads files itself, so it runs the same in the browser and in Node.

import { loadGraph, type RawGraph } from "./graph.ts";
import type { KB, Occupation, Rule, Scheme, Skill } from "./types.ts";

export const EDUCATION_ORDER: Record<string, number> = {
  none: 0, class8: 1, class10: 2, iti: 3, class12: 3, diploma: 4, graduate: 5,
};

export const SECTORS = ["stem", "vocational", "agri", "creative", "services", "govt", "health", "entrepreneurship"];

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.id] = item;
  return out;
}

/** rules must be given in file-name order (the Python loader sorts by path). */
export function buildKb(raw: {
  skills: Skill[];
  occupations: Occupation[];
  schemes: Scheme[];
  rules: Rule[];
  graph?: RawGraph;
}): KB {
  return {
    skills: byId(raw.skills),
    occupations: byId(raw.occupations),
    schemes: byId(raw.schemes),
    rules: byId(raw.rules),
    ...(raw.graph ? { graph: loadGraph(raw.graph) } : {}),
  };
}
