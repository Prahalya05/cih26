import type { Go } from "../App";
import { Pill, Screen, SpeakButton } from "../components/ui";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { SECTOR } from "../lib/labels";

export default function CareerDetail({ go, id, occ }: { go: Go; id: string; occ: string }) {
  const { t, pick } = useT();
  const o = kb.occupations[occ];
  if (!o) return null;
  const steps = o.pathway ?? [];
  return (
    <Screen title={pick(o.name)} onBack={() => go({ name: "results", id, tab: "careers" })}>
      <div className="flex flex-col items-center gap-2 rounded-3xl bg-white p-6 text-center shadow-sm">
        <span className="text-6xl">{SECTOR[o.sector]?.emoji ?? "⭐"}</span>
        <h2 className="text-2xl font-bold">{pick(o.name)}</h2>
        <Pill tone="brand">{pick(SECTOR[o.sector] ?? { en: o.sector })}</Pill>
        {o.description_en && <p className="mt-2 text-muted">{o.description_en}</p>}
      </div>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-xl font-bold">🪜 {t("steps")}</h3>
          <SpeakButton text={steps.join(". ")} />
        </div>
        <ol className="mt-3 flex flex-col gap-3">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
              <span className="pt-1">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      {(o.exams?.length ?? 0) > 0 && (
        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="text-xl font-bold">📝 {t("exams")}</h3>
          <div className="mt-2 flex flex-wrap gap-2">{o.exams!.map((e) => <Pill key={e}>{e}</Pill>)}</div>
        </section>
      )}

      <p className="text-sm text-muted">
        {t("source")}: {o.source_url ? <a className="underline" href={o.source_url} target="_blank" rel="noreferrer">{new URL(o.source_url).hostname}</a> : "—"}
        {o.needs_verification && <> · <span className="text-warn">{t("notVerified")}</span></>}
      </p>
    </Screen>
  );
}
