// "How Disha decides": the end-to-end pipeline, then every rule, formula, AI task and guardrail with its constants
// and source file. Built from the engine's registry, so it always matches the code.

import { PIPELINE, registryOf, type RegistryEntry } from "@disha/engine";
import { useState } from "react";
import type { Go } from "../App";
import { Card, Screen } from "../components/ui";
import { kb } from "../lib/kb";

const KIND: Record<RegistryEntry["kind"], { label: string; cls: string }> = {
  rule: { label: "RULE", cls: "bg-[#1d4ed8] text-white" },
  formula: { label: "FORMULA", cls: "bg-[#0b2a5b] text-white" },
  ai: { label: "AI", cls: "bg-[#7c3aed] text-white" },
  guardrail: { label: "GUARDRAIL", cls: "bg-[#0d7d57] text-white" },
};

export default function HowItDecides({ go, back }: { go: Go; back?: () => void }) {
  const entries = registryOf(kb);
  const [step, setStep] = useState<string>("all");
  const shown = entries.filter((e) => step === "all" || e.step === step);
  const count = (k: RegistryEntry["kind"]) => entries.filter((e) => e.kind === k).length;

  return (
    <Screen title="How Disha decides" onBack={back ?? (() => go({ name: "home" }))}>
      <Card>
        <p className="text-sm leading-relaxed">
          <b>Rules decide, AI listens.</b> Every decision about a student is made by a fixed rule or formula you can read
          below — the same input always gives the same answer. AI is used only where rules can't work: understanding
          free speech and text in her language, scoring a photo or video as one rater among several, and suggesting
          wider career ideas from our catalogue. Every AI output passes a rule check before it is used.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          <span className={`rounded px-2 py-1 ${KIND.rule.cls}`}>{count("rule")} rules</span>
          <span className={`rounded px-2 py-1 ${KIND.formula.cls}`}>{count("formula")} formulas</span>
          <span className={`rounded px-2 py-1 ${KIND.guardrail.cls}`}>{count("guardrail")} guardrails</span>
          <span className={`rounded px-2 py-1 ${KIND.ai.cls}`}>{count("ai")} AI tasks (all checked)</span>
        </div>
      </Card>

      <h2 className="text-lg font-extrabold">End to end</h2>
      <ol className="flex flex-col gap-1.5">
        {PIPELINE.map((p, i) => (
          <li key={p.step}>
            <button onClick={() => setStep(step === p.step ? "all" : p.step)}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${step === p.step ? "border-accent bg-brand-soft" : "border-line bg-surface"}`}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand font-mono text-xs font-bold text-white">{i + 1}</span>
              <span className="text-sm">{p.en}</span>
            </button>
          </li>
        ))}
      </ol>

      <h2 className="text-lg font-extrabold">{step === "all" ? "Every rule, formula and AI task" : `Step: ${step}`} <span className="text-sm font-semibold text-muted">({shown.length})</span></h2>
      <div className="flex flex-col gap-2.5">
        {shown.map((e) => (
          <Card key={e.id}>
            <div className="flex items-start gap-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${KIND[e.kind].cls}`}>{KIND[e.kind].label}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-snug">{e.title}</p>
                <p className="font-mono text-[11px] text-faint">{e.id}</p>
              </div>
            </div>
            <p className="mt-2 text-sm">{e.decides}</p>
            {e.formula && <pre className="mt-2 overflow-x-auto rounded-lg bg-paper p-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">{e.formula}</pre>}
            {e.constants && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-bold text-accent-dark">Constants</summary>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-paper p-2 font-mono text-[11px]">{JSON.stringify(e.constants, null, 1)}</pre>
              </details>
            )}
            {e.checked_by && <p className="mt-2 text-xs"><b>Checked by:</b> <span className="font-mono">{e.checked_by}</span></p>}
            <p className="mt-1 font-mono text-[11px] text-muted">{e.file}</p>
          </Card>
        ))}
      </div>
    </Screen>
  );
}
