import type { Go } from "../App";
import { Pill, Screen, SpeakButton } from "../components/ui";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { SECTOR } from "../lib/labels";
import { Icon } from "../components/Icon";

export default function CareerDetail({ go, id, occ }: { go: Go; id: string; occ: string }) {
  const { t, pick } = useT();
  const o = kb.occupations[occ];
  if (!o) return null;
  const steps = o.pathway ?? [];
  return (
    <Screen title={pick(o.name)} onBack={() => go({ name: "results", id, tab: "careers" })}>
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface p-6 text-center border border-line">
        <span className="flex size-20 items-center justify-center rounded-xl bg-brand-soft text-5xl">{SECTOR[o.sector]?.emoji ?? "⭐"}</span>
        <h2 className="text-2xl font-extrabold">{pick(o.name)}</h2>
        <Pill tone="brand">{pick(SECTOR[o.sector] ?? { en: o.sector })}</Pill>
        {o.description_en && <p className="mt-2 text-muted">{o.description_en}</p>}
      </div>

      <section className="rounded-2xl bg-surface p-5 border border-line">
        <div className="flex items-center gap-2">
          <h3 className="flex flex-1 items-center gap-2 text-xl font-extrabold"><Icon name="steps" className="size-5 text-accent-dark" />{t("steps")}</h3>
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
        <section className="rounded-2xl bg-surface p-5 border border-line">
          <h3 className="flex items-center gap-2 text-xl font-extrabold"><Icon name="pencil" className="size-5 text-accent-dark" />{t("exams")}</h3>
          <div className="mt-2 flex flex-wrap gap-2">{o.exams!.map((e) => <Pill key={e}>{e}</Pill>)}</div>
        </section>
      )}

      {o.rpl && (
        <section className="rounded-2xl bg-surface p-5 border border-line">
          <h3 className="flex items-center gap-2 text-xl font-extrabold"><Icon name="cap" className="size-5 text-accent-dark" />{t("rplTitle")}</h3>
          <p className="mt-2 font-semibold">{o.rpl.qp_name} ({o.rpl.qp_code}){o.rpl.nsqf_level ? ` · ${t("rplLevel", { n: o.rpl.nsqf_level })}` : ""}</p>
          <p className="text-sm text-muted">{o.rpl.ssc}</p>
          {o.rpl.note_en && <p className="mt-1 text-sm text-warn">{o.rpl.note_en}</p>}
          <a className="mt-1 block text-sm underline" href={o.rpl.source_url} target="_blank" rel="noreferrer">{new URL(o.rpl.source_url).hostname}</a>
        </section>
      )}

      <p className="text-sm text-muted">
        {t("source")}: {o.source_url ? <a className="underline" href={o.source_url} target="_blank" rel="noreferrer">{new URL(o.source_url).hostname}</a> : "—"}
        {o.needs_verification && <> · <span className="text-warn">{t("notVerified")}</span></>}
      </p>
    </Screen>
  );
}
