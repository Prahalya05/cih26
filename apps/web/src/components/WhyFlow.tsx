// The "Why?" view: how one decision was made, as a small top-to-bottom flowchart.
//   inputs → AI step (if any) → rule check → formula with real numbers → result
// Built from the decision records in lib/xray.ts.

import type { Decision } from "@disha/engine";
import { useState } from "react";
import { decisionsFor, useDecisions } from "../lib/xray";
import { Icon } from "./Icon";

export const SOURCE_STYLE: Record<Decision["source"], { label: string; chip: string; ring: string }> = {
  RULE: { label: "RULE", chip: "bg-[#1d4ed8] text-white", ring: "border-[#1d4ed8]/40" },
  AI: { label: "AI", chip: "bg-[#7c3aed] text-white", ring: "border-[#7c3aed]/40" },
  AI_CHECKED: { label: "AI → RULE-CHECKED", chip: "bg-gradient-to-r from-[#7c3aed] to-[#0d7d57] text-white", ring: "border-[#0d7d57]/40" },
};

export function SourceChip({ source }: { source: Decision["source"] }) {
  const s = SOURCE_STYLE[source];
  return <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide ${s.chip}`}>{s.label}</span>;
}

function Arrow() {
  return (
    <svg viewBox="0 0 12 22" className="mx-auto h-5 w-3 text-faint" aria-hidden>
      <path d="M6 0v18M1 13l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function Box({ tone, title, children }: { tone: string; title: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border-2 bg-surface p-3 ${tone}`}>
      <p className="text-[11px] font-bold tracking-wide text-muted uppercase">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** The flowchart for one decision. */
export function DecisionFlow({ d }: { d: Decision }) {
  const isAi = d.source !== "RULE";
  return (
    <div className="flex flex-col">
      {d.inputs && Object.keys(d.inputs).length > 0 && (
        <>
          <Box tone="border-line" title="Input">
            <ul className="font-mono text-xs leading-relaxed">
              {Object.entries(d.inputs).map(([k, v]) => <li key={k}><span className="text-muted">{k}:</span> {typeof v === "string" ? v : JSON.stringify(v)}</li>)}
            </ul>
          </Box>
          <Arrow />
        </>
      )}
      {isAi && d.ai && (
        <>
          <Box tone="border-[#7c3aed]/50" title={`AI step · ${d.ai.model}${d.ai.cached ? " · cached" : ""}${d.ai.latency_ms ? ` · ${d.ai.latency_ms} ms` : ""}`}>
            {d.ai.fallback
              ? <p className="text-sm text-warn">AI not used: {d.ai.fallback}</p>
              : <p className="text-sm">AI proposed {(d.ai.kept?.length ?? 0) + (d.ai.dropped?.length ?? 0)} item(s)</p>}
          </Box>
          <Arrow />
        </>
      )}
      {isAi && d.ai && (d.ai.kept || d.ai.dropped) && (
        <>
          <Box tone="border-[#0d7d57]/50" title="Rule check before use">
            {(d.ai.kept ?? []).map((k) => <p key={k} className="text-sm text-good">✓ {k}</p>)}
            {(d.ai.dropped ?? []).map((x) => <p key={x.value} className="text-sm text-bad">✗ {x.value} — {x.reason}</p>)}
            {!d.ai.kept?.length && !d.ai.dropped?.length && <p className="text-sm text-muted">nothing to keep</p>}
          </Box>
          <Arrow />
        </>
      )}
      <Box tone={SOURCE_STYLE[d.source].ring} title={d.source === "RULE" ? `Rule / formula · ${d.ref}` : `Decision · ${d.ref}`}>
        <ul className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
          {d.why.map((w, i) => <li key={i} className={w.endsWith("✗") ? "text-bad" : w.endsWith("✓") ? "text-good" : ""}>{w}</li>)}
        </ul>
      </Box>
      <Arrow />
      <div className="rounded-xl bg-brand px-3 py-2 text-white">
        <p className="text-[11px] font-bold tracking-wide uppercase opacity-70">Result</p>
        <p className="font-bold">{d.output}</p>
      </div>
    </div>
  );
}

/** A full-screen sheet listing every decision about one subject, newest first. */
export function WhySheet({ subject, title, onClose }: { subject: string; title: string; onClose: () => void }) {
  const all = useDecisions();
  const ds = decisionsFor(subject, all).slice().reverse();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-paper p-4 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-lg font-extrabold">Why? · {title}</h2>
          <button onClick={onClose} className="flex size-10 items-center justify-center rounded-full hover:bg-line" aria-label="Close"><Icon name="x" /></button>
        </div>
        {ds.length === 0 && <p className="text-muted">No decision recorded yet for this.</p>}
        <div className="flex flex-col gap-5">
          {ds.slice(0, 3).map((d) => (
            <div key={d.id}>
              <div className="mb-2 flex items-center gap-2"><SourceChip source={d.source} /><span className="text-sm font-semibold">{d.title}</span></div>
              <DecisionFlow d={d} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Small "Why?" button that opens the sheet for one subject. */
export function WhyButton({ subject, title, className = "" }: { subject: string; title: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-bold text-accent-dark hover:border-accent ${className}`}>
        <Icon name="question" className="size-3.5" /> Why?
      </button>
      {open && <WhySheet subject={subject} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}
