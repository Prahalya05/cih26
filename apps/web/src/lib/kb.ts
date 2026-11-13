// The knowledge base is bundled into the app, so matching and eligibility work with no internet.

import { buildKb, type Occupation, type Rule, type Scheme, type Skill } from "@disha/engine";
import occupations from "@kb/occupations.json";
import schemes from "@kb/schemes.json";
import skills from "@kb/skills.json";

const ruleModules = import.meta.glob<{ default: Rule }>("../../../../packages/kb/rules/*.json", { eager: true });
// Same order as the Python loader (sorted by file name).
const rules = Object.keys(ruleModules).sort().map((path) => ruleModules[path].default);

export const kb = buildKb({
  skills: skills as Skill[],
  occupations: occupations as unknown as Occupation[],
  schemes: schemes as Scheme[],
  rules,
});
