// One Aim High track: the shortest route from where she is, the exams on it, what she can become,
// readiness by subject, a week-by-week study plan, and the money and help she can get.

import { useState } from "react";
import { evaluateAll, studyPlan, type Ability } from "@disha/engine";
import type { Go } from "../App";
import { Icon } from "../components/Icon";
import { Button, Pill, Screen, SpeakButton, useLive } from "../components/ui";
import { abilitiesOf, DEFAULT_HOURS, loadAim, patchAim, pw } from "../lib/aim";
import { db } from "../lib/db";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { factsOf } from "../lib/profile";
import { SECTOR, SCHEME_TYPE } from "../lib/labels";
import { rankDoors, shortNode, stageLabel } from "./AimHigh";
import { riasecFromCards } from "../data/cards";

const HOURS = [4, 8, 12, 16];
const FIRST_WEEKS = 6;

export default function AimTrack({ go, id, track }: { go: Go; id: string; track: string }) {
  const { t, pick } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const aim = useLive(() => loadAim(id), [id], null);
  const [allWeeks, setAllWeeks] = useState(false);
  if (!student || !aim) return null;

  const ab = abilitiesOf(aim);
  const { start, open, shut } = rankDoors(student, riasecFromCards(student.cards), ab, aim.goal);
  const d = [...open, ...shut].find((x) => x.track.id === track);
  if (!d) return null;
  const tr = d.track;
  const isGoal = aim.goal === tr.id;
  const hours = aim.hours ?? DEFAULT_HOURS;
  const weeks = Math.min(52, Math.max(8, Math.round(d.months * 4.33)));
  const plan = d.status === "open" ? studyPlan(pw, tr, ab, { weeks, hoursPerWeek: hours }) : null;
  const back = () => go({ name: "results", id, tab: "aim" });

  return (
    <Screen title={pick(tr.name)} onBack={back}>
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-6 text-center">
        <span className="flex size-20 items-center justify-center rounded-xl bg-brand-soft text-5xl">{tr.emoji}</span>
        <h2 className="text-2xl font-extrabold">{pick(tr.name)}</h2>
        <div className="flex flex-wrap justify-center gap-1.5">
          <Pill tone="brand">{pick(SECTOR[tr.sector] ?? { en: tr.sector })}</Pill>
          <Pill tone={d.status === "open" ? "good" : "bad"}>{t(d.status === "open" ? "aimOpen" : d.status === "age" ? "aimAge" : "aimClosed")}</Pill>
        </div>
        {d.status === "open" && (
          <Button kind={isGoal ? "soft" : "accent"} className="mt-2 w-full"
            onClick={() => void patchAim(id, (s) => ({ ...s, goal: isGoal ? undefined : tr.id }))}>
            <Icon name={isGoal ? "check" : "target"} />{t(isGoal ? "aimGoalSet" : "aimSetGoal")}
          </Button>
        )}
      </div>

      <Route d={d} startYears={start.years} stage={stageLabel(student, start, pick)} />

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center gap-2">
          <h3 className="flex flex-1 items-center gap-2 text-xl font-extrabold"><Icon name="star" className="size-5 text-accent-dark" />{t("aimRoles")}</h3>
          <SpeakButton text={tr.roles.map(pick).join(". ")} />
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {tr.roles.map((r) => <li key={r.en} className="flex gap-2"><Icon name="check" className="mt-1 size-4 shrink-0 text-good" />{pick(r)}</li>)}
        </ul>
      </section>

      {d.status === "open" && <Readiness d={d} ab={ab} onCheck={(subject) => go({ name: "aimQuiz", id, subject, mode: "check", track: tr.id })} />}

      {plan && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="flex items-center gap-2 text-xl font-extrabold"><Icon name="clock" className="size-5 text-accent-dark" />{t("aimPlan")}</h3>
          <p className="mt-1 text-sm text-muted">{t("aimPlanHint")}</p>
          <p className="mt-3 text-sm font-semibold">{t("aimHours")}</p>
          <div className="mt-1 flex gap-2">
            {HOURS.map((h) => (
              <button key={h} onClick={() => void patchAim(id, (s) => ({ ...s, hours: h }))} aria-pressed={h === hours}
                className={`min-h-11 flex-1 rounded-xl border text-base font-bold ${h === hours ? "border-brand bg-brand-soft text-brand" : "border-line bg-paper"}`}>{h}</button>
            ))}
          </div>
          {plan.skipped.length > 0 && (
            <p className="mt-3 text-sm text-good">{t("aimKnown", { topics: plan.skipped.map((s) => topicName(s.subject, s.topic, pick)).join(", ") })}</p>
          )}
          <ol className="mt-3 flex flex-col gap-2">
            {mergeRevision(plan.weeks.slice(0, allWeeks ? undefined : FIRST_WEEKS)).map((w) => (
              <li key={w.label} className="rounded-xl bg-paper p-3">
                <p className="font-mono text-xs font-bold text-accent-dark">{w.from === w.to ? t("aimWeek", { n: w.from }) : `${t("aimWeek", { n: w.from })} – ${w.to}`}</p>
                {w.revision ? <p className="font-medium">{t("aimRevision")}</p> : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {w.topics.map((x) => (
                      <li key={x.topic} className="flex gap-2">
                        <span>{pw.subjects[x.subject].emoji}</span>
                        <span className="flex-1">{topicName(x.subject, x.topic, pick)}</span>
                        <span className="text-sm text-muted">{t("aimHrs", { n: x.hours })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {!allWeeks && plan.weeks.length > FIRST_WEEKS && (
            <button className="mt-2 text-sm font-bold text-brand underline" onClick={() => setAllWeeks(true)}>{t("aimShowAll", { n: plan.weeks.length })}</button>
          )}
          {plan.unplaced.length > 0 && <p className="mt-2 text-sm text-warn">{t("aimUnplaced", { n: plan.unplaced.length })}</p>}
        </section>
      )}

      <Exams d={d} />
      <Help trackId={tr.id} quota={tr.quota_7_5} govtSchool={student.factAnswers.school_6_to_12 === "govt"} facts={factsOf(student)} />

      <p className="text-sm text-muted">
        {t("source")}: <a className="underline" href={tr.source_url} target="_blank" rel="noreferrer">{new URL(tr.source_url).hostname}</a>
        {tr.needs_verification && <> · <span className="text-warn">{t("notVerified")}</span></>}
      </p>
      <p className="text-xs text-muted">{t("aimCheckRules")}</p>
    </Screen>
  );
}

type Door = ReturnType<typeof rankDoors>["open"][number];

function Route({ d, startYears, stage }: { d: Door; startYears: number; stage: string }) {
  const { t, pick } = useT();
  if (!d.route) return null;
  const steps = [
    ...(startYears > 0 ? [{ key: "now", name: `${t("aimNow")}${stage ? ` (${stage})` : ""}`, years: startYears, exams: [] as string[], note: undefined, or: [] as string[] }] : []),
    ...d.route.steps.map((e) => ({ key: `${e.from}-${e.to}`, name: pick(pw.nodes[e.to].name), years: e.years, exams: e.exams ?? [], note: e.note,
      // After Class 10 several groups often lead to the same goal: show the others, not just the shortest.
      or: e.from === "c10" ? d.via.filter((n) => n !== e.to).map((n) => shortNode(n, pick)) : [] })),
  ];
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <h3 className="flex flex-1 items-center gap-2 text-xl font-extrabold"><Icon name="steps" className="size-5 text-accent-dark" />{t("aimRoute")}</h3>
        <SpeakButton text={steps.map((s) => s.name).join(". ")} />
      </div>
      <p className="text-sm text-muted">{t("aimYears", { years: d.route.years })}</p>
      <ol className="mt-3 flex flex-col">
        {steps.map((s, i) => (
          <li key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${i === steps.length - 1 ? "bg-accent text-brand-dark" : "bg-brand text-white"}`}>{i + 1}</span>
              {i < steps.length - 1 && <span className="w-0.5 flex-1 bg-line" />}
            </div>
            <div className="flex-1 pb-4">
              <p className="pt-1 font-semibold">{s.name}</p>
              <p className="text-sm text-muted">{t("aimStepYears", { years: s.years })}</p>
              {s.or.length > 0 && <p className="text-sm font-medium text-brand">{t("aimOr", { groups: s.or.join(" / ") })}</p>}
              {s.exams.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{s.exams.map((x) => <Pill key={x}>{pw.exams[x].name}</Pill>)}</div>}
              {s.note && <p className="mt-1 text-sm text-warn">{pick(s.note)}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function levelOf(a: Ability | undefined): "low" | "mid" | "high" | null {
  if (!a || a.n === 0) return null;
  return a.theta < 0 ? "low" : a.theta < 1 ? "mid" : "high";
}

function Readiness({ d, ab, onCheck }: { d: Door; ab: Record<string, Ability>; onCheck: (subject: string) => void }) {
  const { t, pick } = useT();
  const r = d.ready;
  const subjects = Object.entries(d.track.subjects).sort((x, y) => y[1] - x[1]);
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="flex items-center gap-2 text-xl font-extrabold"><Icon name="chart" className="size-5 text-accent-dark" />{t("aimReady")}</h3>
      <p className="mt-1 text-sm text-muted">{t("aimReadyHint")}</p>
      {r.measured > 0 && (
        <div className="mt-3 rounded-xl bg-paper p-3">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-lg font-bold">{t(`aimBand_${r.band}`)}</p>
            <span className="text-sm text-muted">{t("aimMeasured", { n: r.measured, total: r.needed })}</span>
          </div>
          <div className="mt-2 h-2.5 rounded-full bg-line">
            <div className={`h-2.5 rounded-full ${r.band === "on_track" ? "bg-good" : r.band === "building" ? "bg-sun" : "bg-faint"}`} style={{ width: `${Math.round(r.p * 100)}%` }} />
          </div>
          {d.months > 0 && <p className="mt-2 text-sm text-muted">{t("aimMonthsLeft", { n: d.months })}</p>}
          {r.focus && <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-brand"><Icon name="bulb" className="size-4" />{t("aimFocus", { subject: pick(pw.subjects[r.focus].name) })}</p>}
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {subjects.map(([s, w]) => {
          const lvl = levelOf(ab[s]);
          return (
            <li key={s} className="flex items-center gap-3">
              <span className="text-2xl">{pw.subjects[s].emoji}</span>
              <div className="flex-1">
                <p className="font-semibold">{pick(pw.subjects[s].name)} <span className="text-accent-dark" aria-hidden>{"●".repeat(w)}</span></p>
                <p className={`text-sm ${lvl === "high" ? "text-good" : lvl === "low" ? "text-warn" : "text-muted"}`}>{lvl ? t(`aimLevel_${lvl}`) : t("aimNotChecked")}</p>
              </div>
              <button onClick={() => onCheck(s)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-soft px-3 py-2 text-sm font-bold text-brand">
                <Icon name="pencil" className="size-4" />{lvl ? t("aimRecheck") : t("aimCheck")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Exams({ d }: { d: Door }) {
  const { t, pick } = useT();
  const ids = [...new Set((d.route?.steps ?? []).flatMap((e) => e.exams ?? []))];
  if (!ids.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="flex items-center gap-2 text-xl font-extrabold"><Icon name="pencil" className="size-5 text-accent-dark" />{t("aimExams")}</h3>
      <ul className="mt-3 flex flex-col gap-3">
        {ids.map((x) => {
          const e = pw.exams[x];
          return (
            <li key={x} className="border-t border-line pt-3 first:border-0 first:pt-0">
              <p className="font-bold">{e.name}</p>
              <p className="text-xs text-muted">{e.body}</p>
              <p className="mt-1 text-sm">{pick(e.when)}</p>
              {e.url && <a className="mt-1 inline-block text-sm font-semibold text-brand underline" href={e.url} target="_blank" rel="noreferrer">{t("aimOfficial")} ↗</a>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Help({ trackId, quota, govtSchool, facts }: { trackId: string; quota: boolean; govtSchool: boolean; facts: ReturnType<typeof factsOf> }) {
  const { t, pick } = useT();
  const tr = pw.tracks.find((x) => x.id === trackId)!;
  // The same scheme rules as the Money tab, run on her facts, limited to schemes that fit this track.
  const schemes = evaluateAll(kb, facts).filter((s) => tr.schemes.includes(s.scheme_id) && (s.status !== "not_eligible" || s.eligible_if));
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="flex items-center gap-2 text-xl font-extrabold"><Icon name="wallet" className="size-5 text-accent-dark" />{t("aimHelp")}</h3>
      {quota && (
        <div className={`mt-3 rounded-xl p-3 text-sm ${govtSchool ? "bg-good-soft" : "bg-paper"}`}>
          <p>{t("aimQuota")}</p>
          {govtSchool && <p className="mt-1 font-bold text-good">{t("aimQuotaYou")}</p>}
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {tr.help.map((h) => <li key={h.en} className="flex gap-2 text-sm"><Icon name="info" className="mt-0.5 size-4 shrink-0 text-brand" />{pick(h)}</li>)}
      </ul>
      {schemes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {schemes.map((s) => (
            <li key={s.scheme_id} className="flex items-center gap-2 rounded-xl bg-paper p-2.5">
              <span className="text-xl">{SCHEME_TYPE[s.type] ?? "📄"}</span>
              <span className="flex-1 text-sm font-semibold">{pick(s.name)}</span>
              <Pill tone={s.status === "eligible" ? "good" : s.status === "need_info" ? "sun" : "neutral"}>
                {t(s.status === "eligible" ? "eligibleNow" : s.status === "need_info" ? "needInfo" : "eligibleLater")}
              </Pill>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function topicName(subject: string, topic: string, pick: (o: { en: string; ta?: string }) => string) {
  const tp = pw.subjects[subject]?.topics.find((x) => x.id === topic);
  return tp ? pick(tp.name) : topic;
}

/** Collapse a run of empty revision weeks into one row ("Week 30 – 52: revision"). */
function mergeRevision(weeks: ReturnType<typeof studyPlan>["weeks"]) {
  const out: { label: string; from: number; to: number; revision: boolean; topics: ReturnType<typeof studyPlan>["weeks"][number]["topics"] }[] = [];
  for (const w of weeks) {
    const last = out[out.length - 1];
    if (w.revision && last?.revision) { last.to = w.week; last.label = `r${last.from}-${w.week}`; continue; }
    out.push({ label: `w${w.week}`, from: w.week, to: w.week, revision: w.revision, topics: w.topics });
  }
  return out;
}
