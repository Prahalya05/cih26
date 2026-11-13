// Offline skill finder: same idea as apps/api/app/adapters/keywords.py.
// Used when there is no internet or the AI is unavailable.

import { kb } from "./kb";
import type { SkillClaim } from "./db";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function extractKeywords(text: string): SkillClaim[] {
  const t = norm(text);
  if (!t) return [];
  const sentences = text.split(/[.!?।\n]+/).map((s) => s.trim()).filter(Boolean);
  const found: SkillClaim[] = [];
  for (const [id, skill] of Object.entries(kb.skills)) {
    const terms = [...(skill.aliases ?? []), ...Object.values(skill.name)].filter(Boolean) as string[];
    const hit = terms.map(norm).find((term) => term && t.includes(term));
    if (hit) {
      const evidence = sentences.find((s) => norm(s).includes(hit)) ?? text.trim();
      found.push({ id, confidence: 0.5, evidence: evidence.slice(0, 200), source: "text" });
    }
  }
  return found;
}
