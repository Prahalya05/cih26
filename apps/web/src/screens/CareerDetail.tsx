
import type { Go } from "../App";
import { Pill, Screen, SpeakButton } from "../components/ui";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { SECTOR } from "../lib/labels";

export default function CareerDetail({
  go,
  id,
  occ,
}: {
  go: Go;
  id: string;
  occ: string;
}) {
  const { t, pick } = useT();
  const o = kb.occupations[occ];

  if (!o) return null;

  const steps = o.pathway ?? [];

  return (
    <Screen
      title={pick(o.name)}
      onBack={() => go({ name: "results", id, tab: "careers" })}
    >
      <div className="flex flex-col gap-5 pb-4">

        {/* Career overview */}
        <section className="relative overflow-hidden rounded-3xl border border-line bg-white p-6 text-center shadow-sm">
          <div className="absolute -right-8 -top-8 size-28 rounded-full bg-brand-soft/70" />
          <div className="absolute -bottom-10 -left-8 size-28 rounded-full bg-sun-soft/60" />

          <div className="relative flex flex-col items-center gap-3">
            <div className="flex size-24 items-center justify-center rounded-full bg-brand-soft text-6xl">
              {SECTOR[o.sector]?.emoji ?? "⭐"}
            </div>

            <h2 className="text-2xl font-bold leading-tight">
              {pick(o.name)}
            </h2>

            <Pill tone="brand">
              {pick(SECTOR[o.sector] ?? { en: o.sector })}
            </Pill>

            {o.description_en && (
              <p className="mt-1 max-w-prose text-sm leading-6 text-muted">
                {o.description_en}
              </p>
            )}
          </div>
        </section>

        {/* Career pathway */}
        <section className="rounded-3xl border border-line bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-xl">
              🪜
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold">{t("steps")}</h3>
            </div>

            <SpeakButton text={steps.join(". ")} />
          </div>

          {steps.length > 0 ? (
            <ol className="mt-5 flex flex-col gap-4">
              {steps.map((s, i) => (
                <li key={s} className="flex gap-3">
                  <div className="flex shrink-0 flex-col items-center">
                    <span className="flex size-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-white shadow-sm">
                      {i + 1}
                    </span>
                    {i !== steps.length - 1 && (
                      <div className="mt-1 h-full min-h-5 w-0.5 rounded-full bg-brand-soft" />
                    )}
                  </div>

                  <div className="flex-1 rounded-2xl bg-paper p-3">
                    <p className="text-sm leading-6">{s}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-muted">—</p>
          )}
        </section>

        {/* Entrance exams */}
        {(o.exams?.length ?? 0) > 0 && (
          <section className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-sun-soft text-xl">
                📝
              </div>
              <h3 className="text-lg font-bold">{t("exams")}</h3>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {o.exams!.map((e) => (
                <Pill key={e}>{e}</Pill>
              ))}
            </div>
          </section>
        )}

        {/* Recognition of Prior Learning */}
        {o.rpl && (
          <section className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-good-soft text-xl">
                🎓
              </div>
              <h3 className="text-lg font-bold">{t("rplTitle")}</h3>
            </div>

            <div className="mt-4 rounded-2xl bg-good-soft/50 p-4">
              <p className="font-semibold leading-6">
                {o.rpl.qp_name} ({o.rpl.qp_code})
                {o.rpl.nsqf_level
                  ? ` · ${t("rplLevel", { n: o.rpl.nsqf_level })}`
                  : ""}
              </p>

              <p className="mt-2 text-sm text-muted">{o.rpl.ssc}</p>

              {o.rpl.note_en && (
                <p className="mt-3 rounded-xl bg-white/80 p-3 text-sm leading-5 text-warn">
                  {o.rpl.note_en}
                </p>
              )}

              <a
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-dark underline underline-offset-4"
                href={o.rpl.source_url}
                target="_blank"
                rel="noreferrer"
              >
                <span>{new URL(o.rpl.source_url).hostname}</span>
                <span>↗</span>
              </a>
            </div>
          </section>
        )}

        {/* Sources and verification */}
        <section className="rounded-2xl border border-line bg-brand-soft/40 p-4">
          <p className="text-sm leading-6 text-muted">
            <span className="font-semibold text-ink">{t("source")}:</span>{" "}
            {o.source_url ? (
              <a
                className="font-medium underline underline-offset-4"
                href={o.source_url}
                target="_blank"
                rel="noreferrer"
              >
                {new URL(o.source_url).hostname}
              </a>
            ) : (
              "—"
            )}

            {o.needs_verification && (
              <>
                {" · "}
                <span className="font-semibold text-warn">
                  {t("notVerified")}
                </span>
              </>
            )}
          </p>
        </section>
      </div>
    </Screen>
  );
}
