// Teacher courses: which lessons are open (rule.course_access, enforced on the server in routers/courses.py) and which
// courses to suggest to a student (rule.course_recommend). Both fixed rules, never the AI.
//
// A course is suggested when the skill it trains is one she still needs: below the level that one of her top careers
// needs, or a gap in an internship/job she is "Almost" ready for. Courses she has started come first.

import type { Graph } from "./graph.ts";
import type { UnitState } from "./tracing.ts";

export const COURSE_RULE = { platformFee: 0.1, quizPass: 0.7, previewLessons: 1, topCareers: 3 } as const;

export interface CourseSummary { id: string; title: string; skill_id: string; plan: "free" | "per_module" | "subscription"; price_inr: number }

export interface CourseSuggestion { course: CourseSummary; why: string[]; reason: "career" | "opportunity" }

export function recommendCourses(g: Graph, courses: CourseSummary[], units: Record<string, UnitState | undefined>,
  topCareers: { id: string; name: string }[], almostGaps: { opp: string; gaps: string[] }[]): CourseSuggestion[] {
  const out: CourseSuggestion[] = [];
  for (const c of courses) {
    const unit = units[c.skill_id];
    const have = unit?.level ?? 0;
    const why: string[] = [];
    let reason: CourseSuggestion["reason"] | null = null;
    for (const occ of topCareers.slice(0, COURSE_RULE.topCareers)) {
      const need = (g.needs[occ.id] ?? []).find((n) => n.id === c.skill_id || g.subskills[c.skill_id]?.skill === n.id);
      if (need && have < need.level) {
        why.push(`${occ.name} needs ${c.skill_id} at level ${need.level}; she is at ${have || "?"}`);
        reason ??= "career";
      }
    }
    for (const a of almostGaps) if (a.gaps.includes(c.skill_id)) { why.push(`gap for "${a.opp}" (Almost ready)`); reason ??= "opportunity"; }
    if (reason) out.push({ course: c, why: [...why, "→ suggest this course"], reason });
  }
  return out;
}
