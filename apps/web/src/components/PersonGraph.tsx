// One student's knowledge graph, drawn as rings: her in the centre, then interests and skills, then careers, then
// opportunities. Plain SVG (no library), so it stays small on low-end phones. Tap a node to see why it is there.

import { personGraph, type PGEdge, type PGNode, type Profile } from "@disha/engine";
import { useMemo, useState } from "react";
import type { Student } from "../lib/db";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import type { Analysis } from "../lib/profile";
import { Icon } from "./Icon";
import { WhyButton } from "./WhyFlow";

const SIZE = 760;
const C = SIZE / 2;
const RADIUS = [0, 125, 265, 345];
/** Skills she has not shown yet (gaps) sit on their own ring between her skills and the careers. */
const GAP_R = 192;
const isGap = (n: PGNode) => n.kind === "skill" && (n.status === "gap" || !n.value);

const FILL: Record<PGNode["kind"], string> = {
  student: "var(--color-brand)",
  interest: "var(--color-sun)",
  skill: "var(--color-accent)",
  aptitude: "#7c3aed",
  career: "var(--color-brand)",
  opportunity: "var(--color-good)",
};

interface Placed extends PGNode { x: number; y: number; r: number; angle: number }

function layout(nodes: PGNode[], edges: PGEdge[]): Placed[] {
  const byRing: PGNode[][] = [[], [], [], []];
  for (const n of nodes) byRing[n.ring].push(n);
  // More skills -> a wider inner ring, so labels don't sit on top of each other.
  const innerR = Math.min(170, Math.max(110, byRing[1].filter((n) => !isGap(n)).length * 10));
  const out = new Map<string, Placed>();
  const place = (n: PGNode, angle: number) => {
    const rr = isGap(n) ? GAP_R : n.ring === 1 ? innerR : RADIUS[n.ring];
    const r = n.kind === "student" ? 34 : n.kind === "career" ? 24 : n.kind === "skill" ? 11 + 3 * (n.value ?? 0) : n.kind === "opportunity" ? 16 : 14;
    out.set(n.id, { ...n, x: C + rr * Math.cos(angle), y: C + rr * Math.sin(angle), r, angle });
  };
  place(byRing[0][0], 0);
  // Careers evenly round the middle ring.
  byRing[2].forEach((n, i) => place(n, -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, byRing[2].length)));
  // Inner ring: order each node by the average angle of the careers it links to, so lines stay short.
  const angleOf = (id: string) => {
    const linked = edges.filter((e) => e.from === id || e.to === id).map((e) => out.get(e.from === id ? e.to : e.from)).filter((p): p is Placed => !!p && p.ring === 2);
    if (!linked.length) return 10; // unlinked go last
    const sx = linked.reduce((s, p) => s + Math.cos(p.angle), 0), sy = linked.reduce((s, p) => s + Math.sin(p.angle), 0);
    return (Math.atan2(sy, sx) + 2.5 * Math.PI) % (2 * Math.PI);
  };
  const inner = byRing[1].filter((n) => !isGap(n)).sort((a, b) => angleOf(a.id) - angleOf(b.id));
  inner.forEach((n, i) => place(n, -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, inner.length)));
  const gaps = byRing[1].filter(isGap).sort((a, b) => angleOf(a.id) - angleOf(b.id));
  gaps.forEach((n, i) => place(n, -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / Math.max(1, gaps.length)));
  // Outer ring: next to the career they open, spread a little.
  const outer = [...byRing[3]].sort((a, b) => angleOf(a.id) - angleOf(b.id));
  outer.forEach((n, i) => place(n, -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / Math.max(1, outer.length)));
  return [...out.values()];
}

/** Labels point away from the centre (left side right-aligned, right side left-aligned), so rings don't collide. */
function labelPos(n: Placed): { x: number; y: number; textAnchor: "start" | "end" | "middle" } {
  if (n.kind === "student" || n.kind === "career") return { x: n.x, y: n.y + n.r + 14, textAnchor: "middle" };
  const c = Math.cos(n.angle), s = Math.sin(n.angle);
  if (Math.abs(c) < 0.35) return { x: n.x, y: s > 0 ? n.y + n.r + 13 : n.y - n.r - 5, textAnchor: "middle" };
  return { x: n.x + (c > 0 ? 1 : -1) * (n.r + 4), y: n.y + 4, textAnchor: c > 0 ? "start" : "end" };
}

const short = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function PersonGraphView({ student, analysis, profile }: { student: Student; analysis: Analysis; profile: Profile }) {
  const { t, pick } = useT();
  const [sel, setSel] = useState<string | null>(null);
  const picture = student.uiMode === "picture";

  const g = useMemo(() => personGraph({
    kb, name: student.name, profile, careers: analysis.careers.careers, riasec: analysis.persona.riasec,
    opportunities: analysis.opportunities, maxCareers: 5, maxOpps: 6,
  }), [student.name, profile, analysis]);
  const placed = useMemo(() => layout(g.nodes, g.edges), [g]);
  const at = new Map(placed.map((p) => [p.id, p]));
  const selected = sel ? at.get(sel) : undefined;
  const near = new Set(sel ? g.edges.filter((e) => e.from === sel || e.to === sel).flatMap((e) => [e.from, e.to]) : []);

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("mapHint")}</p>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <svg viewBox={`-90 0 ${SIZE + 180} ${SIZE}`} className="block h-auto w-full touch-manipulation" role="img" aria-label={t("map")}>
          {[...RADIUS.slice(1), GAP_R].map((r) => <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="var(--color-line)" strokeDasharray="2 6" />)}
          {g.edges.map((e, i) => {
            const a = at.get(e.from), b = at.get(e.to);
            if (!a || !b) return null;
            const dim = sel && !(near.has(e.from) && near.has(e.to) && (e.from === sel || e.to === sel));
            const stroke = e.kind === "gap" ? "var(--color-faint)" : e.kind === "opens" ? "var(--color-good)" : e.kind === "likes" || e.kind === "fits" ? "var(--color-sun)" : "var(--color-accent-dark)";
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={e.kind === "meets" ? 2.2 : 1.4}
              strokeDasharray={e.kind === "gap" ? "5 5" : undefined} opacity={dim ? 0.12 : 0.75} />;
          })}
          {placed.map((n) => {
            const dim = sel && !near.has(n.id) && sel !== n.id;
            const gap = isGap(n);
            return (
              <g key={n.id} onClick={() => setSel(sel === n.id ? null : n.id)} className="cursor-pointer" opacity={dim ? 0.25 : 1}>
                <circle cx={n.x} cy={n.y} r={n.r + 8} fill="transparent" />
                <circle cx={n.x} cy={n.y} r={n.r} fill={gap ? "var(--color-surface)" : FILL[n.kind]}
                  stroke={gap ? "var(--color-faint)" : n.status === "strong" ? "var(--color-good)" : sel === n.id ? "var(--color-ink)" : "white"}
                  strokeWidth={n.status === "strong" || sel === n.id ? 4 : 2} strokeDasharray={gap ? "4 3" : undefined}
                  opacity={n.kind === "skill" && !gap ? 0.45 + 0.55 * (n.confidence ?? 0.5) : 1} />
                {n.kind === "student" && <text x={n.x} y={n.y + 9} textAnchor="middle" fontSize="26">{student.avatar}</text>}
                {n.kind === "opportunity" && <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize="14" fill="white">{n.status === "ready" ? "✓" : "…"}</text>}
                {n.kind === "skill" && !gap && <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">{n.value}</text>}
                {(!picture || n.kind !== "skill") && (!gap || sel === n.id) ? (
                  <text {...labelPos(n)} fontSize={n.kind === "career" ? 14 : 12} fontWeight={n.kind === "career" ? 800 : 600}
                    fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth="3" paintOrder="stroke">
                    {n.kind === "student" ? short(student.name, 14) : short(pick(n.label), n.kind === "career" ? 20 : 16)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <Legend color="var(--color-sun)" label={t("legendInterest")} />
        <Legend color="var(--color-accent)" label={t("legendSkill")} />
        <Legend color="var(--color-surface)" dashed label={t("legendGap")} />
        <Legend color="var(--color-brand)" label={t("legendCareer")} />
        <Legend color="var(--color-good)" label={t("legendOpp")} />
      </div>

      {selected && <NodeDetail n={selected} analysis={analysis} profile={profile} onClose={() => setSel(null)} />}
    </section>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block size-3 rounded-full" style={{ background: color, border: dashed ? "1.5px dashed var(--color-faint)" : undefined }} />{label}
    </span>
  );
}

function NodeDetail({ n, analysis, profile, onClose }: { n: Placed; analysis: Analysis; profile: Profile; onClose: () => void }) {
  const { t, pick } = useT();
  const unit = profile.units[n.id];
  const opp = n.kind === "opportunity" ? analysis.opportunities.find((o) => `opp:${o.opp.id}` === n.id) : undefined;
  const career = n.kind === "career" ? analysis.careers.careers.find((c) => `career:${c.occupation_id}` === n.id) : undefined;
  return (
    <div className="rounded-2xl border border-accent bg-surface p-4">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-lg font-extrabold">{pick(n.label)}</p>
        <button onClick={onClose} className="rounded-md p-1 hover:bg-paper" aria-label="Close"><Icon name="x" className="size-4" /></button>
      </div>
      {n.kind === "skill" && (
        unit ? (
          <div className="mt-1 text-sm">
            <p>{t("levelN", { n: unit.level })} · {t("sure", { pct: Math.round(unit.confidence * 100) })}{unit.strong ? ` · ${t("strong")}` : ""}</p>
            <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-muted">
              {unit.history.slice(-5).reverse().map((h) => <li key={h.event_id}>{h.kind}: {h.level_before} → {h.level_after} ({Math.round(h.confidence_after * 100)}%)</li>)}
            </ul>
          </div>
        ) : <p className="mt-1 text-sm text-muted">{t("notTestedYet")} — {t("legendGap")}</p>
      )}
      {career && (
        <div className="mt-1 flex items-center gap-2 text-sm">
          <span>Fit {career.parts.fit} · Reach {career.parts.reach} · Worth {career.parts.worth} = <b>{career.score}</b></span>
          <WhyButton subject={`career:${career.occupation_id}`} title={pick(n.label)} />
        </div>
      )}
      {opp && (
        <div className="mt-1 text-sm">
          <p className="font-bold">{t(`opp_${opp.r.status}`)}</p>
          <ul className="mt-1 font-mono text-xs text-muted">{opp.r.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {n.kind === "interest" && <p className="mt-1 text-sm text-muted">{Math.round((n.value ?? 0) * 100)}%</p>}
    </div>
  );
}
