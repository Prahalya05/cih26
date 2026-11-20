// Writes docs/HOW_DISHA_DECIDES.md from the engine's decision registry (the same list the app's
// "How Disha decides" screen and X-ray use), so the document always matches the code.
//
//   node scripts/gen_decisions_doc.ts

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIPELINE, registryOf, type RegistryEntry } from "../packages/engine/src/index.ts";
import { loadKb } from "../packages/engine/test/loadKb.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const kb = loadKb();
const reg = registryOf(kb);
const KIND: Record<RegistryEntry["kind"], string> = { rule: "RULE", formula: "FORMULA", ai: "AI", guardrail: "GUARDRAIL" };
const count = (k: RegistryEntry["kind"]) => reg.filter((e) => e.kind === k).length;

const lines: string[] = [];
const w = (s = "") => lines.push(s);

w("# How Disha decides");
w();
w("_Generated from `packages/engine/src/registry.ts` by `node scripts/gen_decisions_doc.ts`. Do not edit by hand._");
w();
w("**Rules decide, AI listens.** Every decision about a student is made by a fixed rule or formula: the same input always");
w("gives the same answer, and each one has tests. AI is used only where rules cannot work: understanding free speech and");
w("text in her language, scoring a photo or video as one rater among several, and suggesting wider career ideas from our");
w("catalogue. Every AI output passes a rule check before it is used, and the app's **decision X-ray** (`?xray=1`) shows");
w("each decision live, tagged RULE, AI, or AI → RULE-CHECKED.");
w();
w(`| Kind | Count |`);
w(`|---|---|`);
w(`| Rules | ${count("rule")} |`);
w(`| Formulas | ${count("formula")} |`);
w(`| Guardrails | ${count("guardrail")} |`);
w(`| AI tasks (each checked by a rule) | ${count("ai")} |`);
w();
w("## End to end");
w();
w("```mermaid");
w("flowchart LR");
w("  A[Student: voice, text, taps] --> B{Open-ended?}");
w("  B -- yes --> C[AI: transcript, skills, interests, ideas]");
w("  C --> D[Rule check: known ids, real quotes, catalogue only]");
w("  B -- no --> E[Rules and formulas]");
w("  D --> E");
w("  E --> F[Skill levels 1-4]");
w("  F --> G[Careers: Fit + Reach + Worth]");
w("  F --> H[Opportunities: Ready / Almost / Later]");
w("  E --> I[Schemes: JsonLogic eligibility]");
w("  G & H & I --> J[Results + per-student graph + Why?]");
w("```");
w();
PIPELINE.forEach((p, i) => w(`${i + 1}. **${p.step}**: ${p.en}`));
w();
w("## Rules versus AI at a glance");
w();
w("| Decision | Made by | Registry id |");
w("|---|---|---|");
for (const e of reg.filter((x) => !x.id.startsWith("rule.sch_") && !x.id.startsWith("rule.opp_"))) {
  w(`| ${e.title} | ${KIND[e.kind]}${e.checked_by ? ` → checked by \`${e.checked_by}\`` : ""} | \`${e.id}\` |`);
}
w();
for (const p of PIPELINE) {
  const items = reg.filter((e) => e.step === p.step);
  if (!items.length) continue;
  w(`## ${p.step[0].toUpperCase()}${p.step.slice(1).replace("_", " ")}`);
  w();
  for (const e of items) {
    w(`### ${e.title} · \`${KIND[e.kind]}\``);
    w();
    w(`- **Id:** \`${e.id}\``);
    w(`- **Decides:** ${e.decides}`);
    if (e.formula) w(`- **Rule / formula:** \`${e.formula.replace(/`/g, "'")}\``);
    if (e.checked_by) w(`- **Checked by:** \`${e.checked_by}\``);
    w(`- **Code:** \`${e.file}\``);
    if (e.constants) {
      w();
      w("```json");
      w(JSON.stringify(e.constants, null, 1));
      w("```");
    }
    w();
  }
}
// Payouts are not in PIPELINE but are in the registry.
const rest = reg.filter((e) => !PIPELINE.some((p) => p.step === e.step));
if (rest.length) {
  w("## Payouts");
  w();
  for (const e of rest) w(`- **${e.title}** (\`${e.id}\`, ${KIND[e.kind]}): ${e.decides} Code: \`${e.file}\``);
  w();
}

writeFileSync(join(ROOT, "docs", "HOW_DISHA_DECIDES.md"), lines.join("\n"), "utf-8");
console.log(`wrote docs/HOW_DISHA_DECIDES.md (${reg.length} entries)`);
