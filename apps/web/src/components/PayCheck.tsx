// Donor's pay check (rule.paycheck): before any money moves, every student who agreed to share is checked for
// skill shown by her own work, verified need, consent, identity in her video, and not paid twice. Anonymous: a
// pseudonym and a district, never a name.

import { useEffect, useState } from "react";
import { call, isError } from "../lib/auth";
import { useT } from "../lib/i18n";
import { emit } from "../lib/xray";
import { Icon } from "./Icon";
import { Pill } from "./ui";

interface Row { student: string; district?: string; unit: string; unit_name: { en: string; ta?: string }; level: number; ok: boolean;
  /** trust score of her latest work video (a fixed rule over the warnings while filming), or null if none */
  video_trust?: { score: number; band: "high" | "medium" | "low" } | null;
  checks: { name: string; ok: boolean | null; detail: string }[]; why: string[] }

export function PayCheck() {
  const { t, pick } = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void call<{ students: Row[] }>("/v2/funder/paycheck").then((r) => {
      if (isError(r)) { setError(r.error); return; }
      setRows(r.students);
      for (const x of r.students) emit({ step: "payouts", source: "RULE", ref: "rule.paycheck", title: `${x.student}: ${x.ok ? "may be paid" : "hold"}`,
        subject: `pay:${x.student}`, output: x.ok ? "may be paid" : "hold", why: x.why }, `pay:${x.student}:${x.ok}`);
    });
  }, []);
  const ready = rows?.filter((r) => r.ok).length ?? 0;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-lg font-extrabold"><Icon name="shield" className="size-5 text-accent-dark" />{t("payCheckTitle")}</h2>
      <p className="text-sm text-muted">{t("payCheckHint")}</p>
      {error && <p className="rounded-xl bg-sun-soft p-3 text-sm text-warn">{error}</p>}
      {rows && <p className="text-sm font-bold">{t("payCheckSummary", { ready, total: rows.length })}</p>}
      {rows?.length === 0 && <p className="text-muted">{t("payCheckNone")}</p>}
      {rows?.map((r) => (
        <article key={r.student} className={`rounded-2xl border bg-surface p-3 ${r.ok ? "border-good/50" : "border-line"}`}>
          <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === r.student ? null : r.student)}>
            <span className="font-mono font-bold">{r.student}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{pick(r.unit_name)} · L{r.level}{r.district ? ` · ${r.district}` : ""}</span>
            {r.video_trust && (
              <Pill tone={r.video_trust.band === "high" ? "good" : r.video_trust.band === "medium" ? "sun" : "bad"}>
                {t("trustScore", { n: r.video_trust.score })}
              </Pill>
            )}
            <Pill tone={r.ok ? "good" : "sun"}>{r.ok ? t("mayBePaid") : t("hold")}</Pill>
          </button>
          <div className="mt-2 flex flex-wrap gap-1">
            {r.checks.map((c) => <Pill key={c.name} tone={c.ok ? "good" : c.ok === false ? "bad" : "neutral"}>{c.ok ? "✓" : c.ok === false ? "✗" : "?"} {t(`pc_${c.name}` as "pc_skill")}</Pill>)}
          </div>
          {open === r.student && <ul className="mt-2 rounded-lg bg-paper p-2 font-mono text-xs">{r.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </article>
      ))}
    </section>
  );
}
