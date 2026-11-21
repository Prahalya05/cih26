// Internships, apprenticeships, jobs, mentors and free trainings, sorted Ready → Almost → Later by a fixed rule.
// Applying works offline: the application is saved on the phone as an "apply" action and synced later;
// her teacher sees it and can recommend her.

import type { Opportunity, OpportunityKind, OppReadiness } from "@disha/engine";
import { useEffect, useState } from "react";
import { applyCheck, applyOverrides, foldEvents } from "@disha/engine";
import { addAction, db, type Student } from "../lib/db";
import { call, isError } from "../lib/auth";
import { cachedDocs, fetchDocs, statusOf, type DocRow } from "../lib/docs";
import { buildResume, loadExtras } from "../lib/resume";
import { analyse } from "../lib/profile";
import { ITEMS, RUBRICS } from "../lib/skills";
import { emit } from "../lib/xray";
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
  // External sites: opening the link is not applying. Ask her afterwards and only then note it.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const note = (opp: Opportunity, r: OppReadiness, withdrawn: boolean) => void addAction({ student_id: student.id, kind: "apply", by: "student",
    payload: { opportunity_id: opp.id, readiness: r.status, skill_share: r.skill_share, external: true, ...(withdrawn ? { withdrawn: true } : {}) } });
  const list = a.opportunities.filter((x) => kind === "all" || x.opp.kind === kind);
  const groups: OppReadiness["status"][] = ["ready", "almost", "later"];

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-extrabold">{t("oppTitle")}</h2>
        <p className="text-sm text-muted">{t("oppHint")}</p>
      </div>
      <MyJobs a={a} student={student} />
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
              <OppCard key={opp.id} opp={opp} r={r} applied={applied.has(opp.id)} opened={opened.has(opp.id)}
                onApply={() => {
                  if (opp.apply.mode === "external") setOpened((s) => new Set(s).add(opp.id));
                  else setApplying(opp);
                }}
                onConfirm={(yes) => {
                  setOpened((s) => { const n = new Set(s); n.delete(opp.id); return n; });
                  if (yes) note(opp, r, false);
                }}
                onUndo={() => note(opp, r, true)} />
            ))}
          </div>
        );
      })}
      {applying && <ApplySheet opp={applying} student={student} r={a.opportunities.find((x) => x.opp.id === applying.id)!.r} onClose={() => setApplying(null)} />}
    </section>
  );
}

function OppCard({ opp, r, applied, opened, onApply, onConfirm, onUndo }: {
  opp: Opportunity; r: OppReadiness; applied: boolean; opened: boolean;
  onApply: () => void; onConfirm: (applied: boolean) => void; onUndo: () => void;
}) {
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
      {opened && !applied && (
        <div className="mt-3 rounded-xl bg-brand-soft p-3">
          <p className="text-sm font-semibold">{t("didYouApply")}</p>
          <div className="mt-2 flex gap-2">
            <Button className="!min-h-10 !px-3 text-sm" onClick={() => onConfirm(true)}><Icon name="check" className="size-4" />{t("yesApplied")}</Button>
            <Button kind="ghost" className="!min-h-10 !px-3 text-sm" onClick={() => onConfirm(false)}>{t("notYetApplied")}</Button>
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        {applied ? (
          <>
            <Pill tone="good"><Icon name="check" className="size-3.5" />{t("applied")}</Pill>
            {opp.apply.mode === "external" && <button onClick={onUndo} className="text-xs font-bold text-muted underline">{t("didNotApply")}</button>}
          </>
        )
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
  const [error, setError] = useState("");
  const [docs, setDocs] = useState<Record<string, DocRow>>(() => cachedDocs(student.id));
  const [sending, setSending] = useState(false);
  useEffect(() => { void fetchDocs(student.id).then(setDocs); }, [student.id]);
  // rule.apply_docs: every document this kind of listing needs is verified, and she is not "Later".
  const check = applyCheck(opp.kind, r.status, { ...statusOf(docs), resume: "verified" });
  useEffect(() => {
    emit({ step: "opportunities", source: "RULE", ref: "rule.apply_docs", title: `${opp.title.en}: ${check.ok ? "can apply" : "not yet"}`,
      subject: `apply:${opp.id}`, output: check.ok ? "can apply" : "not yet", why: ["resume: made by Disha from her verified record ✓", ...check.why] }, `${student.id}:apply:${opp.id}:${check.ok}`);
  }, [check.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setSending(true); setError("");
    const events = await db.events.where("student_id").equals(student.id).toArray();
    const actions = await db.actions.where("student_id").equals(student.id).toArray();
    const profile = applyOverrides(foldEvents(events, kb.graph!, { now: Date.now(), items: ITEMS, rubrics: RUBRICS }), events);
    const resume = buildResume(student, analyse(student, actions, "en", profile), profile, loadExtras(student.id));
    const res = await call("/v2/applications", { method: "POST", body: JSON.stringify({ student_id: student.id, opportunity_id: opp.id,
      kind: opp.kind, readiness: r.status, message: msg.trim() || null, resume }) });
    setSending(false);
    if (isError(res)) { setError(res.error); return; }
    await addAction({ student_id: student.id, kind: "apply", by: "student",
      payload: { opportunity_id: opp.id, message: msg.trim() || undefined, readiness: r.status, skill_share: r.skill_share, external: false } });
    setDone(true);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-paper p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-extrabold">{pick(opp.title)}</p>
        <p className="text-sm text-muted">{opp.org}</p>
        {done ? (
          <>
            <p className="mt-4 rounded-xl bg-good-soft p-3 font-semibold text-good"><Icon name="check" className="inline size-5" /> {t("applied")}</p>
            <p className="mt-2 text-sm text-muted">{t("applyNote")}</p>
            <Button className="mt-4 w-full" onClick={onClose}>{t("done")}</Button>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm font-bold">{t("docsNeeded")}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              <li className="flex items-center gap-2 text-sm"><Icon name="check" className="size-4 text-good" /><span className="flex-1">{t("doc_resume")}</span><Pill tone="good">{t("madeByDisha")}</Pill></li>
              {check.docs.filter((d) => d.kind !== "resume").map((d) => (
                <li key={d.kind} className="flex items-center gap-2 text-sm">
                  <Icon name={d.status === "verified" ? "check" : d.status === "uploaded" ? "clock" : "x"} className={`size-4 ${d.status === "verified" ? "text-good" : d.status === "uploaded" ? "text-warn" : "text-bad"}`} />
                  <span className="flex-1">{t(`doc_${d.kind}` as StringKey)}</span>
                  <Pill tone={d.status === "verified" ? "good" : d.status === "uploaded" ? "sun" : "neutral"}>{t(`docStatus_${d.status}` as StringKey)}</Pill>
                </li>
              ))}
            </ul>
            {!check.ok && <p className="mt-2 rounded-lg bg-sun-soft p-2 text-sm text-warn">{r.status === "later" ? t("buildSkillsFirst") : t("docsFirst")}</p>}
            <label className="mt-4 flex flex-col gap-1">
              <span className="text-sm font-semibold">{t("applyMessage")}</span>
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} className="rounded-xl border border-line bg-surface p-3" />
            </label>
            <p className="mt-2 flex gap-2 text-xs text-muted"><Icon name="shield" className="size-4 shrink-0" />{t("applySharesNote")}</p>
            {error && <p className="mt-2 rounded-lg bg-bad-soft p-2 text-sm text-bad">{error}</p>}
            <WhyButton subject={`apply:${opp.id}`} title={pick(opp.title)} />
            <Button className="mt-3 w-full" disabled={!check.ok || sending || !navigator.onLine} onClick={() => void submit()}>{sending ? "…" : t("applyNow")}</Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Teacher's suggestions, her applications' status, and links to her resume and documents. */
function MyJobs({ a, student }: { a: Analysis; student: Student }) {
  const { t, pick } = useT();
  const [apps, setApps] = useState<{ id: string; opportunity_id: string; status: string; employer_note?: string }[]>([]);
  useEffect(() => {
    void call<{ applications: typeof apps }>(`/v2/applications/student/${encodeURIComponent(student.id)}`).then((r) => { if (!isError(r)) setApps(r.applications); });
  }, [student.id]);
  const nameOf = (r: { payload: Record<string, unknown> }) => {
    const p = r.payload;
    if (p.opportunity_id) { const o = a.opportunities.find((x) => x.opp.id === p.opportunity_id)?.opp; return o ? `${KIND_EMOJI[o.kind]} ${pick(o.title)}` : String(p.opportunity_id); }
    if (p.scheme_id) return `💰 ${pick(kb.schemes[String(p.scheme_id)]?.name ?? { en: String(p.scheme_id) })}`;
    if (p.occupation_id) return `🧭 ${pick(kb.occupations[String(p.occupation_id)]?.name ?? { en: String(p.occupation_id) })}`;
    return "";
  };
  const go = (name: "resume" | "docs") => window.dispatchEvent(new CustomEvent("disha:go", { detail: { name, id: student.id } }));
  return (
    <>
      {a.recommendations.length > 0 && (
        <div className="rounded-2xl border border-sun/40 bg-sun-soft p-4">
          <p className="flex items-center gap-2 font-extrabold text-warn"><Icon name="star" className="size-5" />{t("teacherSuggests")}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {a.recommendations.map((r) => (
              <li key={r.id} className="text-sm"><span className="font-bold">{nameOf(r)}</span>{r.payload.note ? <span className="block text-muted">“{String(r.payload.note)}”</span> : null}</li>
            ))}
          </ul>
        </div>
      )}
      {apps.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="font-extrabold">{t("myApplications")}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {apps.map((x) => {
              const o = a.opportunities.find((y) => y.opp.id === x.opportunity_id)?.opp;
              return (
                <li key={x.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{o ? pick(o.title) : x.opportunity_id}{x.employer_note ? <span className="block text-xs text-muted">“{x.employer_note}”</span> : null}</span>
                  <Pill tone={x.status === "hired" ? "good" : x.status === "shortlisted" ? "sun" : "neutral"}>{t(`appStatus_${x.status}` as StringKey)}</Pill>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button kind="ghost" className="!min-h-12 text-sm" onClick={() => go("resume")}><Icon name="idcard" className="size-4" />{t("myResume")}</Button>
        <Button kind="ghost" className="!min-h-12 text-sm" onClick={() => go("docs")}><Icon name="clipboard" className="size-4" />{t("myDocs")}</Button>
      </div>
    </>
  );
}
