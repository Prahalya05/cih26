import { useMemo, useState } from "react";
import type { SchemeResult } from "@disha/engine";
import type { Go } from "../App";
import { FactQuestionView } from "../components/FactQuestionView";
import { Button, Pill, Screen, SpeakButton, useLive } from "../components/ui";
import { FACT_QUESTIONS } from "../data/facts";
import { addAction, db, isMinorStudent, patchStudent, type Action, type Student } from "../lib/db";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { formatDate, SCHEME_TYPE, SECTOR } from "../lib/labels";
import { analyse, type Analysis } from "../lib/profile";
import { ITEMS, RUBRICS, profileOf } from "../lib/skills";
import { STORY_KEY } from "../lib/stories";
import { GAMES } from "./Game";
import { nextToTest, personaFromProfile, rplOpportunities, safeRubric, type PersonaV2, type UnitState } from "@disha/engine";

type Tab = "strengths" | "careers" | "schemes";

export default function Results({ go, id, tab }: { go: Go; id: string; tab: Tab }) {
  const { t, lang } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const actions = useLive(() => db.actions.where("student_id").equals(id).toArray(), [id], [] as Action[]);
  const profile = useLive(() => profileOf(id), [id], null);
  const analysis = useMemo(() => (student && profile ? analyse(student, actions, lang, profile) : null), [student, actions, lang, profile]);
  if (!student || !analysis) return null;

  const tabs: { key: Tab; emoji: string }[] = [
    { key: "strengths", emoji: "💪" },
    { key: "careers", emoji: "🧭" },
    { key: "schemes", emoji: "🎓" },
  ];

  return (
    <Screen title={`${student.avatar} ${student.name}`} onBack={() => go({ name: "home" })}>
      <nav className="sticky top-[61px] z-10 -mx-4 grid grid-cols-3 gap-1 bg-paper px-4 pb-2">
        {tabs.map((x) => (
          <button
            key={x.key}
            onClick={() => go({ name: "results", id, tab: x.key })}
            className={`flex min-h-14 flex-col items-center justify-center rounded-2xl text-sm font-semibold ${
              tab === x.key ? "bg-brand text-white" : "bg-white text-muted"
            }`}
          >
            <span className="text-xl">{x.emoji}</span>
            {t(x.key)}
          </button>
        ))}
      </nav>

      {tab === "strengths" && <><Games id={id} go={go} />
        <Button kind="soft" onClick={() => go({ name: "order", id })}>💼 {t("paidJob")}</Button><SkillLevels id={id} go={go} claimed={analysis.skills.map((s) => s.id)}
        persona={personaFromProfile(profile!, { education: analysis.persona.education, riasec: analysis.persona.riasec })} />
        <Strengths a={analysis} /></>}
      {tab === "careers" && <Careers a={analysis} go={go} id={id} />}
      {tab === "schemes" && <Schemes a={analysis} student={student} />}

      <Feedback studentId={id} tab={tab} actions={actions} />

      <div className="mt-4 flex gap-2">
        <Button kind="ghost" className="flex-1 text-base" onClick={() => go({ name: "cards", id })}>↺ {t("restart")}</Button>
        <Button kind="ghost" className="flex-1 text-base" onClick={() => go({ name: "privacy", id })}>🔒 {t("privacy")}</Button>
      </div>
    </Screen>
  );
}

/** The three 3-minute puzzle games that measure how quickly she could learn new kinds of work. */
function Games({ id, go }: { id: string; go: Go }) {
  const { t, pick } = useT();
  const profile = useLive(() => profileOf(id), [id], null);
  if (!profile) return null;
  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm">
      <h2 className="text-xl font-bold">{t("gamesTitle")}</h2>
      <p className="text-sm text-muted">{t("gamesHint")}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {GAMES.map((g) => {
          const played = (profile.aptitude[g.domain]?.n ?? 0) > 0;
          return (
            <button key={g.domain} onClick={() => go({ name: "game", id, domain: g.domain })}
              className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 p-2 text-sm font-semibold ${
                played ? "border-good bg-good-soft text-good" : "border-line bg-paper"}`}>
              <span className="text-3xl">{g.emoji}</span>
              <span className="text-center leading-tight">{pick(kb.graph!.aptitudes[g.domain].name)}</span>
              {played && <span>✓</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Levels 1-4 per sub-skill, rebuilt from evidence events, with a test button where questions exist. */
function SkillLevels({ id, go, claimed, persona }: { id: string; go: Go; claimed: string[]; persona: PersonaV2 }) {
  const { t, pick } = useT();
  const profile = useLive(() => profileOf(id), [id], null);
  const student = useLive(() => db.students.get(id), [id], undefined);
  if (!profile || !student) return null;
  const g = kb.graph!;
  const minor = isMinorStudent(student); // no work samples on hazardous sub-skills under 18
  const testable = new Set(Object.values(ITEMS).map((it) => it.subskill));
  const skills = Object.keys(g.bySkill).filter((sk) =>
    claimed.includes(sk) || g.bySkill[sk].some((u) => (profile.units[u]?.n ?? 0) > 0));
  // The test most likely to change her career list (only sub-skills that have questions, not yet sure).
  const candidates = [...testable].filter((u) => (profile.units[u]?.confidence ?? 0) < 0.8 || (profile.units[u]?.n ?? 0) === 0);
  const best = nextToTest(kb, persona, candidates, 1)[0];
  const rpl = rplOpportunities(kb, profile.units, minor);
  return (
    <section className="flex flex-col gap-3">
      <StoryBanner id={id} />
      {rpl.map((r) => (
        <button key={r.occupation} onClick={() => go({ name: "career", id, occ: r.occupation })}
          className="flex items-start gap-3 rounded-3xl bg-good-soft p-4 text-left shadow-sm">
          <span className="text-3xl">🎓</span>
          <span className="flex-1">
            <span className="block text-lg font-semibold">{r.rpl.qp_name}{r.rpl.nsqf_level ? ` · ${t("rplLevel", { n: r.rpl.nsqf_level })}` : ""}</span>
            <span className="block">{t(r.status === "eligible" ? "rplEligible" : "rplAt18")}</span>
            <span className="mt-1 block text-sm text-muted">{t("rplCheck")}</span>
          </span>
        </button>
      ))}
      {skills.length > 0 && <h2 className="text-2xl font-bold">{t("skillLevels")}</h2>}
      {skills.length > 0 && <p className="text-muted">{t("skillLevelsHint")}</p>}
      {best && best.value > 0 && (
        <button onClick={() => go({ name: "assess", id, subskill: best.id })}
          className="flex items-center gap-3 rounded-3xl bg-brand p-4 text-left text-white shadow-sm active:bg-brand-dark">
          <span className="text-3xl">🎯</span>
          <span className="flex-1">
            <span className="block text-sm opacity-90">{t("nextTest")}</span>
            <span className="block text-lg font-semibold">{pick(g.subskills[best.id].name)}</span>
          </span>
          <span className="text-2xl">›</span>
        </button>
      )}
      {skills.map((sk) => (
        <article key={sk} className="rounded-3xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-lg font-semibold">{pick(kb.skills[sk].name)}</h3>
            {Object.values(RUBRICS).filter((r) => r.skill === sk && safeRubric(g, r, minor)).map((r) => (
              <button key={r.id} onClick={() => go({ name: "sample", id, rubric: r.id })}
                className="rounded-xl bg-sun-soft px-3 py-2 text-sm font-semibold text-warn">📷 {t("showWork")}</button>
            ))}
          </div>
          <ul className="mt-2 flex flex-col gap-3">
            {g.bySkill[sk].map((u) => (
              <SubskillRow key={u} unitId={u} unit={profile.units[u]} canTest={testable.has(u)}
                onTest={() => go({ name: "assess", id, subskill: u })} />
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

/** While a demo story replays, says which step was just added. */
function StoryBanner({ id }: { id: string }) {
  const { t, pick } = useT();
  const row = useLive(() => db.meta.get(STORY_KEY), [], undefined);
  const v = row?.value as { student: string; step: number; of: number; label: { en: string; ta: string } } | undefined;
  if (!v || v.student !== id) return null;
  return (
    <div className="sticky top-2 z-10 rounded-3xl bg-brand p-4 text-white shadow-lg" role="status" aria-live="polite">
      <p className="text-sm opacity-90">▶ {t("storyStep", { n: v.step + 1, of: v.of })}</p>
      <p className="text-lg font-semibold">{pick(v.label)}</p>
    </div>
  );
}

function SubskillRow({ unitId, unit, canTest, onTest }: { unitId: string; unit?: UnitState; canTest: boolean; onTest: () => void }) {
  const { t, pick } = useT();
  const sub = kb.graph!.subskills[unitId];
  const direct = unit && unit.n > 0;
  const kinds = [...new Set((unit?.history ?? []).map((h) => h.kind))];
  const tested = kinds.includes("test");
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <p className="flex-1 font-medium">{pick(sub.name)}</p>
        {unit?.strong && <Pill tone="good">💪 {t("strong")}</Pill>}
      </div>
      {direct ? (
        <>
          <div className="flex gap-1" aria-label={t("levelN", { n: unit.level })}>
            {[1, 2, 3, 4].map((L) => (
              <div key={L} className={`h-2.5 flex-1 rounded-full ${L <= unit.level ? (unit.confidence >= 0.8 ? "bg-good" : "bg-sun") : "bg-line"}`} />
            ))}
          </div>
          <p className="text-sm text-muted">
            {t("levelN", { n: unit.level })}: {t(`level${unit.level}` as "level1")} · {t("sure", { pct: Math.round(unit.confidence * 100) })}
          </p>
          <p className="text-xs text-muted">{t("basedOn")}: {kinds.map((k) => t(`ev_${k}` as "ev_test")).join(", ")}</p>
        </>
      ) : (
        <p className="text-sm text-muted">{t("notTestedYet")}</p>
      )}
      {canTest && (
        <button onClick={onTest} className="self-start rounded-xl bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-dark">
          📝 {tested ? t("testAgain") : t("testMe")}
        </button>
      )}
    </li>
  );
}

function Strengths({ a }: { a: Analysis }) {
  const { t, pick } = useT();
  if (!a.skills.length) return <p className="text-muted">—</p>;
  const summary = a.skills.slice(0, 5).map((s) => pick(kb.skills[s.id].name)).join(", ");
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <h2 className="flex-1 text-2xl font-bold">{t("strengths")}</h2>
        <SpeakButton text={`${t("strengths")}: ${summary}`} />
      </div>
      {a.skills.map((s) => (
        <article key={s.id} className="rounded-3xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-lg font-semibold">{pick(kb.skills[s.id].name)}</h3>
            {s.endorsed && <Pill tone="good">✔ {t("endorsedBy")}</Pill>}
          </div>
          <div className="mt-2 h-2 rounded-full bg-line">
            <div className="h-2 rounded-full bg-sun" style={{ width: `${Math.round(s.confidence * 100)}%` }} />
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-muted">
            {s.evidence.map((e) => (
              <li key={e.text}>
                {e.source === "tap" ? `${t("tapped")}: ${e.text}` : <>“{e.text}” <span className="text-xs">{e.source === "voice" ? "🎤" : "⌨️"}</span></>}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function Careers({ a, go, id }: { a: Analysis; go: Go; id: string }) {
  const { t, pick } = useT();
  const sectors = new Set(a.careers.careers.map((c) => c.sector));
  const careerName = (oid: string) => pick(kb.occupations[oid].name);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <h2 className="flex-1 text-2xl font-bold">{t("careers")}</h2>
        <SpeakButton text={a.careers.careers.map((c) => careerName(c.occupation_id)).join(", ")} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[...sectors].map((s) => <Pill key={s} tone="brand">{SECTOR[s]?.emoji} {pick(SECTOR[s] ?? { en: s })}</Pill>)}
      </div>
      {a.careers.careers.map((c, i) => {
        const occ = kb.occupations[c.occupation_id];
        const recommended = a.recommendations.some((r) => r.payload.occupation_id === c.occupation_id);
        return (
          <button
            key={c.occupation_id}
            onClick={() => go({ name: "career", id, occ: c.occupation_id })}
            className="flex flex-col gap-2 rounded-3xl bg-white p-4 text-left shadow-sm active:bg-stone-50"
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">{SECTOR[c.sector]?.emoji ?? "⭐"}</span>
              <div className="flex-1">
                <h3 className="text-lg leading-tight font-semibold">{i + 1}. {pick(occ.name)}</h3>
                <p className="text-sm text-muted">{pick(SECTOR[c.sector] ?? { en: c.sector })}</p>
              </div>
              <span className="text-xl text-muted">›</span>
            </div>
            {recommended && <Pill tone="good">⭐ {t("recommended")}</Pill>}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Bar label={t("skillMatch")} value={c.parts.fit} />
              <Bar label={t("reachable")} value={c.parts.reach} />
              <Bar label={t("interestFit")} value={c.parts.worth} />
            </div>
            {c.could_learn && <Pill tone="sun">🚀 {t("couldLearn")}</Pill>}
            {c.matched_skills.length > 0 && (
              <p className="text-sm text-muted">{t("whyFits")}: {c.matched_skills.map((s) => pick(kb.skills[s].name)).join(", ")}</p>
            )}
          </button>
        );
      })}

      {a.careers.what_if.length > 0 && (
        <div className="rounded-3xl bg-sun-soft p-4">
          <h3 className="text-lg font-bold">💡 {t("whatIf")}</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {a.careers.what_if.map((w) => {
              const [kind, value] = w.lever.split(":");
              const label = kind === "education"
                ? t("whatIfEdu", { level: t(`edu_${value}` as Parameters<typeof t>[0]) })
                : t("whatIfSkill", { skill: pick(kb.graph!.subskills[value]?.name ?? kb.skills[value]?.name ?? { en: value }) });
              return (
                <li key={w.lever}>
                  <p className="font-semibold">{label}:</p>
                  <p className="text-muted">{w.unlocks.map(careerName).join(", ")}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="h-1.5 rounded-full bg-line"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.round(value * 100)}%` }} /></div>
      <p className="mt-1 text-muted">{label}</p>
    </div>
  );
}

function Schemes({ a, student }: { a: Analysis; student: Student }) {
  const { t } = useT();
  const now = a.schemes.filter((s) => s.status === "eligible");
  const info = a.schemes.filter((s) => s.status === "need_info");
  const later = a.schemes.filter((s) => s.status !== "eligible" && s.eligible_if);
  const recommendedIds = new Set(a.recommendations.map((r) => r.payload.scheme_id));

  // Ask the missing facts that would unlock the most schemes first.
  const missingCounts = new Map<string, number>();
  for (const s of info) for (const f of s.missing_facts) missingCounts.set(f, (missingCounts.get(f) ?? 0) + 1);
  const nextFacts = [...missingCounts.entries()].sort((x, y) => y[1] - x[1]).map(([f]) => f).filter((f) => FACT_QUESTIONS[f]).slice(0, 2);

  const setFact = (key: string, v: unknown) =>
    void patchStudent(student.id, (s) => ({ ...s, factAnswers: { ...s.factAnswers, [key]: v } }));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xl font-bold">✅ {t("eligibleNow")}</h2>
      {now.length ? now.map((s) => <SchemeCard key={s.scheme_id} s={s} recommended={recommendedIds.has(s.scheme_id)} />) : <p className="text-muted">{t("noneNow")}</p>}

      {nextFacts.length > 0 && (
        <div className="flex flex-col gap-4 rounded-3xl border-2 border-dashed border-sun bg-white p-4">
          <h2 className="text-lg font-bold">❓ {t("needInfo")}</h2>
          {nextFacts.map((f) => (
            <FactQuestionView key={f} q={FACT_QUESTIONS[f]} value={student.factAnswers[f]} onChange={(v) => setFact(f, v)} />
          ))}
        </div>
      )}

      {later.length > 0 && (
        <>
          <h2 className="mt-2 text-2xl font-bold">⏳ {t("eligibleLater")}</h2>
          {later.map((s) => <SchemeCard key={s.scheme_id} s={s} later recommended={recommendedIds.has(s.scheme_id)} />)}
        </>
      )}
    </section>
  );
}

function SchemeCard({ s, later, recommended }: { s: SchemeResult; later?: boolean; recommended?: boolean }) {
  const { t, pick, lang } = useT();
  const [open, setOpen] = useState(false);
  const scheme = kb.schemes[s.scheme_id];
  return (
    <article className={`rounded-3xl p-4 shadow-sm ${later ? "bg-white/70" : "bg-white"}`}>
      <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="text-3xl">{SCHEME_TYPE[s.type] ?? "📄"}</span>
        <div className="flex-1">
          <h3 className="text-lg leading-tight font-semibold">{pick(s.name)}</h3>
          {later && s.eligible_if && <p className="text-sm font-medium text-warn">{t("afterJoining", { stage: t(`stage_${s.eligible_if.stage}` as Parameters<typeof t>[0]) })}</p>}
          {recommended && <Pill tone="good">⭐ {t("recommended")}</Pill>}
        </div>
        <span className="text-xl text-muted">{open ? "▾" : "›"}</span>
      </button>
      <p className="mt-2">{s.benefit_en}</p>
      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <p className="font-semibold">{t("documents")}:</p>
          <ul className="list-inside list-disc text-muted">{s.required_documents.map((d) => <li key={d}>{d}</li>)}</ul>
          <div className="flex flex-wrap gap-2">
            <a href={s.apply_url} target="_blank" rel="noreferrer" className="rounded-xl bg-brand px-3 py-2 font-semibold text-white">{t("apply")} ↗</a>
            <a href={s.source_url} target="_blank" rel="noreferrer" className="rounded-xl border border-line px-3 py-2 font-medium">{t("source")} ↗</a>
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        {t("ruleUpdated", { date: formatDate(s.rule_updated, lang) })} ·{" "}
        {scheme.verified_on ? t("verifiedOn", { date: formatDate(scheme.verified_on, lang) }) : <span className="text-warn">{t("notVerified")}</span>}
      </p>
    </article>
  );
}

function Feedback({ studentId, tab, actions }: { studentId: string; tab: Tab; actions: Action[] }) {
  const { t } = useT();
  const given = actions.some((a) => a.kind === "feedback" && a.payload.tab === tab);
  if (given) return <p className="text-center text-good">🙏 {t("thanks")}</p>;
  const send = (helpful: boolean) => addAction({ student_id: studentId, kind: "feedback", payload: { tab, helpful }, by: "student" });
  return (
    <div className="flex items-center justify-center gap-3 rounded-2xl bg-white p-3">
      <span className="font-medium">{t("wasHelpful")}</span>
      <button onClick={() => send(true)} className="size-12 rounded-full bg-good-soft text-2xl" aria-label="Yes">👍</button>
      <button onClick={() => send(false)} className="size-12 rounded-full bg-stone-100 text-2xl" aria-label="No">👎</button>
    </div>
  );
}
