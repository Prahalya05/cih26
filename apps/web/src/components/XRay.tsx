// The decision X-ray panel: every decision as it happens, colour-coded RULE / AI / AI → RULE-CHECKED.
// On a laptop or projector it sits to the right of the phone-sized app; on a phone it is a bottom drawer.

import type { Decision } from "@disha/engine";
import { useEffect, useRef, useState } from "react";
import { clearDecisions, exportSession, importSession, replaceDecisions, summary, useDecisions, xrayReplay } from "../lib/xray";
import { Icon } from "./Icon";
import { DecisionFlow, SourceChip } from "./WhyFlow";

type Filter = "all" | "RULE" | "AI";

export default function XRay({ onClose, onHow }: { onClose: () => void; onHow: () => void }) {
  const live = useDecisions();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [replay, setReplay] = useState<Decision[] | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const source = replay ? replay.slice(0, step) : live;
  const shown = source.filter((d) => filter === "all" || (filter === "RULE" ? d.source === "RULE" : d.source !== "RULE"));
  const s = summary(source);

  // Newest first; scroll to the top when something new arrives.
  useEffect(() => { listRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, [source.length]);
  // Replay plays one decision every 1.2 s.
  useEffect(() => {
    if (!replay || !playing) return;
    if (step >= replay.length) { setPlaying(false); return; }
    const t = setTimeout(() => setStep(step + 1), 1200);
    return () => clearTimeout(t);
  }, [replay, playing, step]);
  useEffect(() => { if (xrayReplay()) fileRef.current?.click(); }, []);

  const load = async (f: File | undefined) => {
    if (!f) return;
    try { const ds = await importSession(f); setReplay(ds); setStep(0); setPlaying(true); } catch (e) { alertInline(String(e)); }
  };
  const [note, setNote] = useState("");
  const alertInline = (m: string) => { setNote(m); setTimeout(() => setNote(""), 4000); };

  const panel = (
    <div className="flex h-full flex-col bg-[#0b1220] text-[#e6edf7]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-accent text-brand-dark"><Icon name="scan" className="size-4" /></span>
        <div className="flex-1">
          <p className="text-sm font-extrabold tracking-wide">DECISION X-RAY{replay && <span className="ml-2 rounded bg-sun px-1.5 py-0.5 text-[10px] text-brand-dark">REPLAY {step}/{replay.length}</span>}</p>
          <p className="text-[11px] text-white/60">Which decisions are fixed rules, which are AI — live</p>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Close X-ray"><Icon name="x" className="size-4" /></button>
      </div>

      {/* session summary: the one-line takeaway */}
      <div className="grid grid-cols-3 gap-2 border-b border-white/10 px-4 py-3 text-center">
        <Stat n={s.rule} label="rule decisions" color="text-[#60a5fa]" />
        <Stat n={s.ai} label="AI steps" color="text-[#c4b5fd]" />
        <Stat n={s.dropped} label="AI items rejected by rules" color="text-[#fca5a5]" />
      </div>
      <p className="border-b border-white/10 px-4 py-2 text-[12px] text-white/70">
        Rules decide; AI only reads open-ended speech and text and suggests. {s.checked} AI suggestion{s.checked === 1 ? "" : "s"} went through a rule check{s.fallbacks ? `; ${s.fallbacks} fell back to rules (no AI)` : ""}.
      </p>

      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
        {(["all", "RULE", "AI"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2.5 py-1 text-xs font-bold ${filter === f ? "bg-white text-[#0b1220]" : "bg-white/10"}`}>
            {f === "all" ? "All" : f === "RULE" ? "Rules" : "AI"}
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={onHow} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-bold hover:bg-white/20">All rules</button>
        {replay ? (
          <>
            <button onClick={() => setPlaying(!playing)} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-bold">{playing ? "Pause" : "Play"}</button>
            <button onClick={() => setStep(Math.min(replay.length, step + 1))} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-bold">Step</button>
            <button onClick={() => { setReplay(null); setPlaying(false); }} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-bold">Live</button>
          </>
        ) : (
          <>
            <button onClick={exportSession} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-bold hover:bg-white/20" title="Save this session for replay">Save</button>
            <button onClick={() => fileRef.current?.click()} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-bold hover:bg-white/20">Replay</button>
            <button onClick={clearDecisions} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-bold hover:bg-white/20">Clear</button>
          </>
        )}
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => void load(e.target.files?.[0])} />
      </div>
      {replay && step === replay.length && replay.length > 0 && (
        <button onClick={() => replaceDecisions(replay)} className="mx-4 mb-2 rounded-md bg-white/10 py-1 text-xs">Keep this replay as the live session</button>
      )}
      {note && <p className="mx-4 mb-2 rounded bg-bad px-2 py-1 text-xs">{note}</p>}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 pb-6">
        {shown.length === 0 && <p className="px-1 py-6 text-center text-sm text-white/50">Use the app — each decision appears here as it is made.</p>}
        {shown.slice().reverse().map((d) => (
          <div key={d.id} className="xray-in mb-2 rounded-lg border border-white/10 bg-white/[0.04]">
            <button onClick={() => setOpen(open === d.id ? null : d.id)} className="flex w-full items-start gap-2 p-2.5 text-left">
              <SourceChip source={d.source} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug font-semibold">{d.title}</span>
                <span className="block truncate font-mono text-[11px] text-white/50">{d.step} · {d.ref}{d.ai?.dropped?.length ? ` · ${d.ai.dropped.length} rejected` : ""}{d.ai?.fallback ? " · fallback" : ""}{d.ai?.cached ? " · cached" : ""}</span>
              </span>
              <span className="font-mono text-[10px] text-white/40">{new Date(d.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </button>
            {open === d.id && <div className="rounded-b-lg bg-paper p-3 text-ink"><DecisionFlow d={d} /></div>}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {/* laptop / projector: fixed right column */}
      <aside className="fixed top-0 right-0 bottom-0 z-40 hidden w-[440px] border-l border-black/20 shadow-2xl lg:block">{panel}</aside>
      {/* phone: a tab at the bottom that opens a drawer */}
      <div className="lg:hidden">
        {!mobileOpen && (
          <button onClick={() => setMobileOpen(true)} className="fixed right-3 bottom-3 z-40 flex items-center gap-2 rounded-full bg-[#0b1220] px-3 py-2 text-xs font-bold text-white shadow-lg">
            <Icon name="scan" className="size-4" /> X-ray · {s.rule} rule / {s.ai} AI
          </button>
        )}
        {mobileOpen && (
          <div className="fixed inset-x-0 bottom-0 z-50 h-[70dvh] overflow-hidden rounded-t-2xl shadow-2xl">
            <div className="relative h-full">
              {panel}
              <button onClick={() => setMobileOpen(false)} className="absolute top-3 right-12 rounded-md bg-white/10 px-2 py-1 text-xs text-white">Hide</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div>
      <p className={`font-mono text-2xl font-extrabold ${color}`}>{n}</p>
      <p className="text-[10px] leading-tight text-white/60">{label}</p>
    </div>
  );
}
