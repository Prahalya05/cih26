// One student's knowledge graph: the shared skill graph seen from her side.
// Rings, from the centre out: the student -> her interests, skills and aptitudes -> careers -> opportunities.
// Built only from her evidence (foldEvents), the career scores and opportunity readiness: no AI.

import type { CareerV2 } from "./fitreach.ts";
import type { Profile } from "./tracing.ts";
import type { Opportunity, OppReadiness } from "./readiness.ts";
import type { KB, Lang } from "./types.ts";

export type PGKind = "student" | "interest" | "skill" | "aptitude" | "career" | "opportunity";

export interface PGNode {
  id: string;
  kind: PGKind;
  label: Lang;
  ring: 0 | 1 | 2 | 3;
  /** skills: level 1-4 (0 = not shown yet, a gap); careers: score; opportunities: skill share */
  value?: number;
  confidence?: number;
  /** skills: Strong; opportunities: ready/almost/later */
  status?: string;
  /** evidence count for skills */
  n?: number;
}

export interface PGEdge {
  from: string;
  to: string;
  kind: "has" | "likes" | "meets" | "gap" | "fits" | "opens";
}

const RIASEC_NAMES: Record<string, Lang> = {
  R: { en: "Hands-on", ta: "கைவேலை", hi: "हाथ का काम" },
  I: { en: "Finding out", ta: "ஆராய்தல்", hi: "खोजबीन" },
  A: { en: "Creating", ta: "படைத்தல்", hi: "रचना" },
  S: { en: "Helping people", ta: "உதவுதல்", hi: "लोगों की मदद" },
  E: { en: "Leading, selling", ta: "தலைமை, விற்பனை", hi: "नेतृत्व, बिक्री" },
  C: { en: "Organising", ta: "ஒழுங்குபடுத்தல்", hi: "व्यवस्था" },
};

export function personGraph(args: {
  kb: KB;
  name: string;
  profile: Profile;
  careers: CareerV2[];
  riasec?: Partial<Record<string, number>>;
  opportunities?: { opp: Opportunity; r: OppReadiness }[];
  maxCareers?: number;
  maxOpps?: number;
}): { nodes: PGNode[]; edges: PGEdge[] } {
  const { kb, profile } = args;
  const g = kb.graph;
  const nodes = new Map<string, PGNode>();
  const edges: PGEdge[] = [];
  const add = (n: PGNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const skillLabel = (id: string): Lang => g?.subskills[id]?.name ?? kb.skills[id]?.name ?? { en: id };

  add({ id: "me", kind: "student", label: { en: args.name }, ring: 0 });

  // Interests: letters she likes at least half as much as her favourite.
  const r = args.riasec ?? {};
  const top = Math.max(0, ...Object.values(r).map((x) => x ?? 0));
  const liked = top > 0 ? Object.entries(r).filter(([, v]) => (v ?? 0) >= top * 0.5 && (v ?? 0) > 0).map(([k]) => k) : [];
  for (const L of liked) {
    add({ id: `int:${L}`, kind: "interest", label: RIASEC_NAMES[L] ?? { en: L }, ring: 1, value: r[L] });
    edges.push({ from: "me", to: `int:${L}`, kind: "likes" });
  }

  // Skills she has evidence for.
  for (const u of Object.values(profile.units)) {
    if (u.n === 0) continue;
    add({ id: u.id, kind: "skill", label: skillLabel(u.id), ring: 1, value: u.level, confidence: u.confidence, status: u.strong ? "strong" : undefined, n: u.n });
    edges.push({ from: "me", to: u.id, kind: "has" });
  }
  for (const [id, a] of Object.entries(profile.aptitude)) {
    if (!a.n) continue;
    add({ id, kind: "aptitude", label: g?.aptitudes[id]?.name ?? { en: id }, ring: 1, value: a.theta });
    edges.push({ from: "me", to: id, kind: "has" });
  }

  // Careers, linked to the skills they need (met or a gap) and the interests they fit.
  for (const c of args.careers.slice(0, args.maxCareers ?? 5)) {
    const occ = kb.occupations[c.occupation_id];
    if (!occ) continue;
    const cid = `career:${occ.id}`;
    add({ id: cid, kind: "career", label: occ.name, ring: 2, value: c.score });
    for (const m of c.met) { add({ id: m, kind: "skill", label: skillLabel(m), ring: 1, value: profile.units[m]?.level ?? 0 }); edges.push({ from: m, to: cid, kind: "meets" }); }
    for (const gp of c.gaps.slice(0, 2)) {
      add({ id: gp, kind: "skill", label: skillLabel(gp), ring: 1, value: profile.units[gp]?.level ?? 0, status: profile.units[gp] ? undefined : "gap" });
      edges.push({ from: gp, to: cid, kind: "gap" });
    }
    for (const L of liked) if (occ.riasec.includes(L)) edges.push({ from: `int:${L}`, to: cid, kind: "fits" });
  }

  // Opportunities she is closest to, linked to a career they open, else to her.
  const opps = (args.opportunities ?? []).filter((x) => x.r.status !== "later").slice(0, args.maxOpps ?? 6);
  for (const { opp, r: rd } of opps) {
    const oid = `opp:${opp.id}`;
    add({ id: oid, kind: "opportunity", label: opp.title, ring: 3, value: rd.skill_share, status: rd.status });
    const via = (opp.careers ?? []).map((c) => `career:${c}`).filter((c) => nodes.has(c));
    if (via.length) for (const c of via) edges.push({ from: c, to: oid, kind: "opens" });
    else edges.push({ from: "me", to: oid, kind: "opens" });
  }
  return { nodes: [...nodes.values()], edges };
}
