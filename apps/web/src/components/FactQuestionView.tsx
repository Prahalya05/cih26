import { SpeakButton } from "./ui";
import type { FactQuestion } from "../data/facts";
import { useT } from "../lib/i18n";

/** One fact question with big tap options (or a number stepper for age). */
export function FactQuestionView({ q, value, onChange }: { q: FactQuestion; value: unknown; onChange: (v: unknown) => void }) {
  const { pick } = useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-lg font-semibold">{pick(q)}</p>
        <SpeakButton text={pick(q)} audioKey={`fact_${q.key}`} />
      </div>
      {q.number ? (
        <div className="flex items-center gap-3">
          <button
            className="size-14 rounded-xl border border-line bg-surface text-2xl font-extrabold"
            onClick={() => onChange(Math.max(q.number!.min, (Number(value) || 16) - 1))}
            aria-label="−"
          >−</button>
          <span className="min-w-16 text-center text-3xl font-bold">{value === undefined ? "–" : String(value)}</span>
          <button
            className="size-14 rounded-xl border border-line bg-surface text-2xl font-extrabold"
            onClick={() => onChange(Math.min(q.number!.max, (Number(value) || 15) + 1))}
            aria-label="+"
          >+</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {q.options!.map((o) => (
            <button
              key={String(o.value)}
              onClick={() => onChange(value === o.value ? undefined : o.value)}
              aria-pressed={value === o.value}
              className={`min-h-12 rounded-xl border px-4 text-base font-medium ${
                value === o.value ? "border-brand bg-brand-soft ring-1 ring-brand text-brand-dark" : "border-line bg-surface"
              }`}
            >
              {o.emoji && <span className="mr-1.5">{o.emoji}</span>}
              {pick(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
