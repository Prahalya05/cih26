// One component per question format. Each shows the question and reports { correct, value, ms }.
// Options are shuffled per student so friends sitting together see different orders.

import { useEffect, useMemo, useRef, useState } from "react";
import { seededRandom } from "@disha/engine";
import { useT } from "../lib/i18n";
import { speak } from "../lib/speech";
import { Button, SpeakButton } from "./ui";

type Lang = { en: string; ta?: string };

export interface ChoiceItem {
  id: string; format: "choice"; prompt: Lang; answer: string;
  options: (Lang & { id: string; emoji?: string; image?: string })[];
}
export interface EstimateItem {
  id: string; format: "estimate"; prompt: Lang; answer: number; tolerance?: number; unit?: Lang;
}
export interface OrderItem {
  id: string; format: "order_steps"; prompt: Lang; steps: (Lang & { id: string })[]; answer: string[];
}
export type QuestionItem = ChoiceItem | EstimateItem | OrderItem;
export const SUPPORTED_FORMATS = ["choice", "estimate", "order_steps"];

export interface ItemAnswer {
  correct: boolean;
  value: unknown;
  ms: number;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffled<T>(list: T[], seed: string): T[] {
  const rand = seededRandom(hash(seed));
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function ItemView({ item, seed, onAnswer }: { item: QuestionItem; seed: string; onAnswer: (a: ItemAnswer) => void }) {
  const { pick, lang } = useT();
  const started = useRef(Date.now());
  useEffect(() => {
    started.current = Date.now();
    speak(pick(item.prompt), lang, `item_${item.id}`);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = (correct: boolean, value: unknown) => onAnswer({ correct, value, ms: Date.now() - started.current });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <h2 className="flex-1 text-xl leading-snug font-bold">{pick(item.prompt)}</h2>
        <SpeakButton text={pick(item.prompt)} audioKey={`item_${item.id}`} />
      </div>
      {item.format === "choice" && <Choice item={item} seed={seed} onPick={(id) => answer(id === item.answer, id)} />}
      {item.format === "estimate" && <Estimate item={item} onDone={(v) => answer(Math.abs(v - item.answer) <= (item.tolerance ?? 0), v)} />}
      {item.format === "order_steps" && <Order item={item} seed={seed} onDone={(ids) => answer(ids.join() === item.answer.join(), ids)} />}
    </div>
  );
}

function Choice({ item, seed, onPick }: { item: ChoiceItem; seed: string; onPick: (id: string) => void }) {
  const { pick } = useT();
  const options = useMemo(() => shuffled(item.options, seed + item.id), [item, seed]);
  return (
    <div className="flex flex-col gap-2.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onPick(o.id)}
          className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-line bg-white px-4 py-3 text-left text-lg font-medium active:border-brand active:bg-brand-soft">
          {o.emoji && <span className="text-3xl">{o.emoji}</span>}
          {o.image && <img src={o.image} alt="" className="size-16 rounded-xl object-cover" />}
          <span>{pick(o)}</span>
        </button>
      ))}
    </div>
  );
}

function Estimate({ item, onDone }: { item: EstimateItem; onDone: (v: number) => void }) {
  const { t, pick } = useT();
  const [text, setText] = useState("");
  const value = Number(text.replace(/[^\d.-]/g, ""));
  const ok = text.trim() !== "" && Number.isFinite(value);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ok && onDone(value)}
          placeholder={t("estimateHint")} aria-label={t("estimateHint")}
          className="min-h-14 flex-1 rounded-2xl border-2 border-line bg-white px-4 text-2xl font-semibold" />
        {item.unit && <span className="text-lg text-muted">{pick(item.unit)}</span>}
      </div>
      <Button onClick={() => onDone(value)} disabled={!ok}>{t("check")}</Button>
    </div>
  );
}

function Order({ item, seed, onDone }: { item: OrderItem; seed: string; onDone: (ids: string[]) => void }) {
  const { t, pick } = useT();
  const [steps, setSteps] = useState(() => shuffled(item.steps, seed + item.id));
  const [picked, setPicked] = useState<number | null>(null);
  const tap = (i: number) => {
    if (picked === null) return setPicked(i);
    if (picked !== i) {
      const next = [...steps];
      [next[picked], next[i]] = [next[i], next[picked]];
      setSteps(next);
    }
    setPicked(null);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-muted">{t("orderHint")}</p>
      {steps.map((s, i) => (
        <button key={s.id} onClick={() => tap(i)} aria-pressed={picked === i}
          className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 py-2 text-left text-lg ${
            picked === i ? "border-brand bg-brand-soft" : "border-line bg-white"}`}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-stone-100 font-bold">{i + 1}</span>
          <span>{pick(s)}</span>
        </button>
      ))}
      <Button onClick={() => onDone(steps.map((s) => s.id))}>{t("check")}</Button>
    </div>
  );
}
