// Internships, apprenticeships, jobs, mentors and free trainings, sorted Ready → Almost → Later by a fixed rule.
// Applying works offline: the application is saved on the phone as an "apply" action and synced later;
// her teacher sees it and can recommend her.

import type { Opportunity, OpportunityKind, OppReadiness } from "@disha/engine";
import { useState } from "react";
import { addAction, type Student } from "../lib/db";
import { useT, type StringKey } from "../lib/i18n";
import { kb } from "../lib/kb";
import type { Analysis } from "../lib/profile";
import { Icon } from "./Icon";
import { Button, Pill } from "./ui";
import { WhyButton } from "./WhyFlow";

const KINDS: OpportunityKind[] = ["internship", "apprenticeship", "job", "mentorship", "training"];
const KIND_EMOJI: Record<OpportunityKind, string> = { internship: "🧑‍💻", apprenticeship: "🛠️", job: "💼", mentorship: "🧭", training: "🎓" };

export function Opportunities({ a, student }: { a: Analysis; student: Student }) {
  const { t } = useT();
  const [kind, setKind] = useState<OpportunityKind | "all">("all");
  const [applying, setApplying] = useState<Opportunity | null>(null);
  const applied = new Set(a.applications.map((x) => String(x.payload.opportunity_id)));
  const list = a.opportunities.filter((x) => kind === "all" || x.opp.kind === kind);
  const groups: OppReadiness["status"][] = ["ready", "almost", "later"];

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-extrabold">{t("oppTitle")}</h2>
        <p className="text-sm text-muted">{t("oppHint")}</p>
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {(["all", ...KINDS] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-bold ${kind === k ? "border-brand bg-brand text-white" : "border-line bg-surface"}`}>
            {k === "all" ? t("allKinds") : `${KIND_EMOJI[k]} ${t(`kind_${k}` as StringKey)}`}
          </button>
        ))}
      </div>
      {groups.map((g) => {
        const items = list.filter((x) => x.r.status === g);
        if (!items.length) return null;
        return (
          <div key={g} className="flex flex-col gap-2">
            <p className={`eyebrow ${g === "ready" ? "!text-good" : g === "almost" ? "!text-warn" : ""}`}>{t(`opp_${g}`)} · {items.length}</p>
            {items.map(({ opp, r }) => (
              <OppCard key={opp.id} opp={opp} r={r} applied={applied.has(opp.id)} onApply={() => {
                // External: the link opens the official site; we only note that she went to apply.
                if (opp.apply.mode === "external") void addAction({ student_id: student.id, kind: "apply", by: "student",
                  payload: { opportunity_id: opp.id, readiness: r.status, skill_share: r.skill_share, external: true } });
                else setApplying(opp);
              }} />
            ))}
          </div>
        );
      })}
      {applying && <ApplySheet opp={applying} student={student} r={a.opportunities.find((x) => x.opp.id === applying.id)!.r} onClose={() => setApplying(null)} />}
    </section>
  );
}

function OppCard({ opp, r, applied, onApply }: { opp: Opportunity; r: OppReadiness; applied: boolean; onApply: () => void }) {
  const { t, pick } = useT();
  const unit = (id: string) => pick(kb.graph?.subskills[id]?.name ?? kb.skills[id]?.name ?? { en: id });
  return (
    <article className={`rounded-2xl border bg-surface p-4 ${r.status === "ready" ? "border-good/40" : "border-line"}`}>
      <div className="flex items-start gap-3">
        <span className="text-3xl">{KIND_EMOJI[opp.kind]}</span>
        <div className="min-w-0 flex-1">
          <p className="leading-snug font-bold">{pick(opp.title)}</p>
          <p className="text-sm text-muted">{opp.org}{opp.district ? ` · ${opp.district}` : opp.state ? ` · ${opp.state}` : ""}{opp.mode === "remote" ? " · remote" : ""}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Pill tone={r.status === "ready" ? "good" : r.status === "almost" ? "sun" : "neutral"}>{t(`opp_${r.status}`)} · {Math.round(r.skill_share * 100)}%</Pill>
            <Pill>{t(`kind_${opp.kind}` as StringKey)}</Pill>
            {opp.stipend_inr_month ? <Pill tone="brand">{t("stipend", { n: opp.stipend_inr_month.toLocaleString("en-IN") })}</Pill> : null}
            {opp.duration_months ? <Pill>{t("monthsN", { n: opp.duration_months })}</Pill> : null}
            {opp.sample && <Pill tone="sun">{t("sampleListing")}</Pill>}
          </div>
        </div>
      </div>
      {opp.description_en && <p className="mt-2 text-sm">{opp.description_en}</p>}
      {r.status === "almost" && r.gaps.length > 0 && <p className="mt-2 rounded-lg bg-sun-soft px-2 py-1 text-sm text-warn">{t("toClose", { skills: r.gaps.map(unit).join(", ") })}</p>}
      <div className="mt-3 flex items-center gap-2">
        {applied ? <Pill tone="good"><Icon name="check" className="size-3.5" />{t("applied")}</Pill>
          : opp.apply.mode === "external"
            ? <a href={opp.apply.url} target="_blank" rel="noreferrer" onClick={onApply} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-bold text-white"><Icon name="link" className="size-4" />{t("applyOutside")}</a>
            : <Button className="!min-h-10 !px-3 text-sm" disabled={r.status === "later"} onClick={onApply}>{t("applyNow")}</Button>}
        <span className="flex-1" />
        <WhyButton subject={`opp:${opp.id}`} title={pick(opp.title)} />
      </div>
    </article>
  );
}

function ApplySheet({ opp, student, r, onClose }: { opp: Opportunity; student: Student; r: OppReadiness; onClose: () => void }) {
  const { t, pick } = useT();
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  const submit = async () => {
    await addAction({ student_id: student.id, kind: "apply", by: "student",
      payload: { opportunity_id: opp.id, message: msg.trim() || undefined, readiness: r.status, skill_share: r.skill_share, external: false } });
    setDone(true);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-paper p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-extrabold">{pick(opp.title)}</p>
        <p className="text-sm text-muted">{opp.org}</p>
        {done ? (
          <>
            <p className="mt-4 rounded-xl bg-good-soft p-3 font-semibold text-good"><Icon name="check" className="inline size-5" /> {t("applied")}</p>
            <p className="mt-2 text-sm text-muted">{t("applyNote")}{navigator.onLine ? "" : ` ${t("offline")}`}</p>
            <Button className="mt-4 w-full" onClick={onClose}>{t("done")}</Button>
          </>
        ) : (
          <>
            <label className="mt-4 flex flex-col gap-1">
              <span className="text-sm font-semibold">{t("applyMessage")}</span>
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} className="rounded-xl border border-line bg-surface p-3" />
            </label>
            <Button className="mt-4 w-full" onClick={submit}>{t("applyNow")}</Button>
          </>
        )}
      </div>
    </div>
  );
}
