// Node-only helper: reads packages/kb from disk. The PWA will load the same JSON over HTTP instead.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKb } from "../src/kb.ts";
import type { KB } from "../src/types.ts";

export const KB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "kb");

const read = (path: string) => JSON.parse(readFileSync(path, "utf-8"));

export function loadKb(dir = KB_DIR): KB {
  const ruleFiles = readdirSync(join(dir, "rules")).filter((f) => f.endsWith(".json")).sort();
  return buildKb({
    skills: read(join(dir, "skills.json")),
    occupations: read(join(dir, "occupations.json")),
    schemes: read(join(dir, "schemes.json")),
    rules: ruleFiles.map((f) => read(join(dir, "rules", f))),
    graph: {
      subskills: read(join(dir, "graph", "subskills.json")),
      aptitudes: read(join(dir, "graph", "aptitudes.json")),
      edges: read(join(dir, "graph", "edges.json")),
    },
  });
}
