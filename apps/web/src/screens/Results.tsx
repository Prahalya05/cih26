import { useEffect, useMemo, useState } from "react";
import type { SchemeResult } from "@disha/engine";
import type { Go } from "../App";
import { FactQuestionView } from "../components/FactQuestionView";
import { Button, Pill, Screen, SpeakButton, useLive } from "../components/ui";
import { FACT_QUESTIONS } from "../data/facts";
import { addAction, db, isMinorStudent, patchStudent, type Action, type Student } from "../lib/db";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { formatDate, SCHEME_TYPE, SECTOR } from "../lib/labels";
import { analyse, traceAnalysis, type Analysis } from "../lib/profile";
import { careerDecision, checkPersonalised, explainCareer, scoreAllV2, type Dropped, type PersonalWhy } from "@disha/engine";
import { Opportunities } from "../components/Opportunities";
import { PersonGraphView } from "../components/PersonGraph";
import { WhyButton } from "../components/WhyFlow";
import { careerIdeasRemote, personaliseRemote } from "../lib/sync";
import { useSchemeCatalog } from "../lib/schemes";
import { emit } from "../lib/xray";
import { ITEMS, RUBRICS, profileOf } from "../lib/skills";
import { STORY_KEY } from "../lib/stories";
import { GAMES } from "./Game";
import { nextToTest, personaFromProfile, rplOpportunities, safeRubric, type PersonaV2, type UnitState } from "@disha/engine";
import { Icon, type IconName } from "../components/Icon";
import { AimHigh } from "./AimHigh";

type Tab = "strengths" | "careers" | "schemes" | "opps" | "map" | "aim";

export default function Results({ go, id, tab }: { go: Go; id: string; tab: Tab }) {
  const { t, lang } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const actions = useLive(() => db.actions.where("student_id").equals(id).toArray(), [id], [] as Action[]);
  const profile = useLive(() => profileOf(id), [id], null);
  const catalog = useSchemeCatalog(); // a new scheme list from the server re-checks eligibility
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const analysis = useMemo(() => (student && profile ? analyse(student, actions, lang, profile) : null), [student, actions, lang, profile, catalog.version]);
  // Report every decision behind this screen to the X-ray (each once, until its result changes).
  useEffect(() => { if (student && analysis) traceAnalysis(student, analysis); }, [student, analysis]);
  if (!student || !analysis) return null;

  const tabs: { key: Tab; icon: IconName }[] = [
    { key: "strengths", icon: "award" },
    { key: "careers", icon: "target" },
    { key: "schemes", icon: "cap" },
    { key: "opps", icon: "briefcase" },
    { key: "map", icon: "chain" },
    { key: "aim", icon: "spark" },
  ];

  return (
    <Screen title={<span className="flex items-center gap-2"><span className="text-xl">{student.avatar}</span>{student.name}</span>} onBack={() => go({ name: "home" })}>
      <nav className="sticky top-[60px] z-10 -mx-4 -mt-5 grid grid-cols-6 border-b border-line bg-surface px-1">
        {tabs.map((x) => (
          <button
            key={x.key}
            onClick={() => go({ name: "results", id, tab: x.key })}
            className={`-mb-px flex min-h-14 flex-col items-center justify-center gap-1 border-b-[3px] text-[11px] leading-tight font-bold ${
              tab === x.key ? "border-accent text-brand" : "border-transparent text-muted"
            }`}
          >
            <Icon name={x.icon} className="size-5" />
            {t(x.key)}
          </button>
        ))}
      </nav>

      {tab === "strengths" && <><Games id={id} go={go} />
        <Button kind="soft" onClick={() => go({ name: "order", id })}><Icon name="briefcase" className="size-5" />{t("paidJob")}</Button>
        <Button kind="soft" onClick={() => go({ name: "proof", id })}><Icon name="lock" className="size-5" />{t("proofPays")}</Button>
        <SkillLevels id={id} go={go} claimed={analysis.skills.map((s) => s.id)}
        persona={personaFromProfile(profile!, { education: analysis.persona.education, riasec: analysis.persona.riasec })} />
        <Strengths a={analysis} /></>}
      {tab === "careers" && <Careers a={analysis} go={go} id={id} student={student} />}
      {tab === "schemes" && <Schemes a={analysis} student={student} />}
      {tab === "opps" && <Opportunities a={analysis} student={student} />}
      {tab === "map" && <PersonGraphView student={student} analysis={analysis} profile={profile!} />}
      {tab === "aim" && <AimHigh a={analysis} go={go} id={id} student={student} />}

      <Feedback studentId={id} tab={tab} actions={actions} />

      <div className="mt-4 flex gap-2">
        <Button kind="ghost" className="flex-1 text-base" onClick={() => go({ name: "cards", id })}><Icon name="refresh" className="size-4" />{t("restart")}</Button>
        <Button kind="ghost" className="flex-1 text-base" onClick={() => go({ name: "privacy", id })}><Icon name="lock" className="size-4" />{t("privacy")}</Button>
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
    <section className="rounded-2xl bg-surface p-4 border border-line">
      <h2 className="text-xl font-extrabold">{t("gamesTitle")}</h2>
      <p className="text-sm text-muted">{t("gamesHint")}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {GAMES.map((g) => {
          const played = (profile.aptitude[g.domain]?.n ?? 0) > 0;
          return (
            <button key={g.domain} onClick={() => go({ name: "game", id, domain: g.domain })}
              className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border p-2 text-sm font-semibold ${
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
          className="flex items-start gap-3 rounded-2xl bg-good-soft p-4 text-left border border-line">
          <span className="flex size-10 items-center justify-center rounded-xl bg-surface text-good"><Icon name="cap" className="size-6" /></span>
          <span className="flex-1">
            <span className="block text-lg font-semibold">{r.rpl.qp_name}{r.rpl.nsqf_level ? ` · ${t("rplLevel", { n: r.rpl.nsqf_level })}` : ""}</span>
            <span className="block">{t(r.status === "eligible" ? "rplEligible" : "rplAt18")}</span>
            <span className="mt-1 block text-sm text-muted">{t("rplCheck")}</span>
          </span>
        </button>
      ))}
      {skills.length > 0 && <h2 className="text-2xl font-extrabold">{t("skillLevels")}</h2>}
      {skills.length > 0 && <p className="text-muted">{t("skillLevelsHint")}</p>}
      {best && best.value > 0 && (
        <button onClick={() => go({ name: "assess", id, subskill: best.id })}
          className="flex items-center gap-3 rounded-2xl bg-brand p-4 text-left text-white active:bg-brand-dark">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-accent"><Icon name="target" className="size-6" /></span>
          <span className="flex-1">
            <span className="block text-sm opacity-90">{t("nextTest")}</span>
            <span className="block text-lg font-semibold">{pick(g.subskills[best.id].name)}</span>
          </span>
          <Icon name="chevron" className="size-6" />
        </button>
      )}
      {skills.map((sk) => (
        <article key={sk} className="rounded-2xl bg-surface p-4 border border-line">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-lg font-semibold">{pick(kb.skills[sk].name)}</h3>
            {Object.values(RUBRICS).filter((r) => r.skill === sk && safeRubric(g, r, minor)).map((r) => (
              <button key={r.id} onClick={() => go({ name: "sample", id, rubric: r.id })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sun-soft px-3 py-2 text-sm font-bold text-warn"><Icon name="camera" className="size-4" />{t("showWork")}</button>
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
    <div className="sticky top-2 z-10 rounded-2xl bg-brand p-4 text-white shadow-lg" role="status" aria-live="polite">
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
        {unit?.strong && <Pill tone="good"><Icon name="award" className="size-3.5" />{t("strong")}</Pill>}
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
        <button onClick={onTest} className="inline-flex items-center gap-1.5 self-start rounded-lg bg-brand-soft px-3 py-2 text-sm font-bold text-brand">
          <Icon name="pencil" className="size-4" />{tested ? t("testAgain") : t("testMe")}
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
        <h2 className="flex-1 text-2xl font-extrabold">{t("strengths")}</h2>
        <SpeakButton text={`${t("strengths")}: ${summary}`} />
      </div>
      {a.skills.map((s) => (
        <article key={s.id} className="rounded-2xl bg-surface p-4 border border-line">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-lg font-semibold">{pick(kb.skills[s.id].name)}</h3>
            {s.endorsed && <Pill tone="good"><Icon name="check" className="size-3.5" />{t("endorsedBy")}</Pill>}
          </div>
          <div className="mt-2 h-2 rounded-full bg-line">
            <div className="h-2 rounded-full bg-sun" style={{ width: `${Math.round(s.confidence * 100)}%` }} />
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-muted">
            {s.evidence.map((e) => (
              <li key={e.text}>
                {e.source === "tap" ? `${t("tapped")}: ${e.text}` : <>“{e.text}” <Icon name={e.source === "voice" ? "mic" : "keyboard"} className="inline size-3.5 align-[-2px]" /></>}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

const TOP = 5;

/** Everything she said, word for word: the AI's reasons must quote one of these. */
function quotesOf(student: Student, a: Analysis): string[] {
  const out = new Set<string>();
  for (const s of a.skills) for (const e of s.evidence) if (e.source !== "tap") out.add(e.text);
  for (const ans of Object.values(student.answers)) { const w = ans.transcript || ans.text; if (w) out.add(w); }
  for (const c of student.interests?.claims ?? []) out.add(c.evidence);
  if (student.interests?.text) out.add(student.interests.text);
  return [...out].map((x) => x.trim().slice(0, 300)).filter(Boolean).slice(0, 30);
}

interface Personal { order: string[]; why: Record<string, PersonalWhy>; reason: string; ai: boolean }
const personalMemo = new Map<string, Personal>();

/**
 * The formula picks and scores her careers; the AI then orders the top 5 for her and explains each in her own words.
 * A rule (checkPersonalised) keeps the order inside the shortlist and keeps a reason only if its quote is real.
 * Offline, or if the AI fails, the formula order stays.
 */
function usePersonalised(a: Analysis, student: Student, lang: string): Personal | "loading" | null {
  const top = a.careers.careers.slice(0, TOP);
  const quotes = quotesOf(student, a);
  const key = JSON.stringify([top.map((c) => c.occupation_id), quotes, a.persona.riasec ?? null, a.persona.education, lang]);
  const [res, setRes] = useState<Personal | "loading" | null>(() => personalMemo.get(key) ?? null);
  useEffect(() => {
    const hit = personalMemo.get(key);
    if (hit) { setRes(hit); return; }
    const formula = top.map((c) => c.occupation_id);
    if (top.length < 2 || !navigator.onLine) { setRes(null); return; }
    let live = true;
    setRes("loading");
    void personaliseRemote({
      shortlist: top.map((c) => ({ id: c.occupation_id, score: Math.round(c.score * 1000) / 1000, matched_skills: c.matched_skills })),
      quotes, riasec: a.persona.riasec as Record<string, number> | undefined, education: a.persona.education,
    }, lang).then((r) => {
      const name = (oid: string) => kb.occupations[oid]?.name.en ?? oid;
      let out: Personal;
      if (r && r.source !== "unavailable") {
        const checked = checkPersonalised(r, formula, quotes);
        const dropped: Dropped[] = [...(r.trace?.dropped ?? []), ...checked.dropped];
        out = { order: checked.order, why: checked.why, reason: r.order_reason, ai: true };
        const moves = checked.order.map((oid, i) => ({ oid, from: formula.indexOf(oid) + 1, to: i + 1 })).filter((m) => m.from !== m.to);
        emit({
          step: "careers", source: "AI_CHECKED", ref: "ai.personalise_careers", subject: `order:${student.id}`,
          title: moves.length ? `AI re-ordered her top ${formula.length} careers (${moves.length} moved)` : `AI kept the formula order of her top ${formula.length}`,
          inputs: { formula_order: formula.map(name).join(" > "), her_words: `${quotes.length} quotes` },
          output: checked.order.map(name).join(" > "),
          why: [
            `the rules chose these ${formula.length} careers; the AI may only change their order`,
            ...(r.order_reason ? [`AI's reason: ${r.order_reason}`] : []),
            ...moves.map((m) => `${name(m.oid)}: #${m.from} → #${m.to}`),
            ...Object.entries(checked.why).map(([oid, w]) => `${name(oid)} ✓ ${w.quote ? `quote found: "${w.quote}"` : "no quote (general reason)"}`),
            ...dropped.map((d) => `${d.value} ✗ ${d.reason}`),
          ],
          ai: { model: r.trace?.model ?? "gemini", latency_ms: r.trace?.latency_ms, kept: checked.order, dropped, cached: r.trace?.cached },
        }, `order:${student.id}`);
        for (const [oid, w] of Object.entries(checked.why)) {
          emit({
            step: "careers", source: "AI_CHECKED", ref: "ai.personalise_careers", subject: `career:${oid}`, title: `Why ${name(oid)} fits her (AI, checked)`,
            output: w.why,
            why: [w.quote ? `her words: "${w.quote}" ✓ found in what she said` : "no quote: a general reason",
              `place in her list: #${checked.order.indexOf(oid) + 1} (formula #${formula.indexOf(oid) + 1})`],
            ai: { model: r.trace?.model ?? "gemini", latency_ms: r.trace?.latency_ms },
          }, `why:${student.id}:${oid}`);
        }
      } else {
        out = { order: formula, why: {}, reason: "", ai: false };
        emit({
          step: "careers", source: "RULE", ref: "formula.fitreach", subject: `order:${student.id}`, title: "Top careers in formula order (AI not reached)",
          output: formula.map(name).join(" > "), why: [r?.trace?.fallback ?? "no answer from the server", "the order stays the Fit + Reach + Worth score"],
        }, `order:${student.id}`);
      }
      personalMemo.set(key, out);
      if (live) setRes(out);
    });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return res;
}

function Careers({ a, go, id, student }: { a: Analysis; go: Go; id: string; student: Student }) {
  const { t, pick, lang } = useT();
  const sectors = new Set(a.careers.careers.map((c) => c.sector));
  const careerName = (oid: string) => pick(kb.occupations[oid].name);
  const personal = usePersonalised(a, student, lang);
  const p = personal && personal !== "loading" ? personal : null;
  // Her order for the top 5 (AI, checked); the rest keep the formula order below them.
  const ordered = p
    ? [...p.order.map((oid) => a.careers.careers.find((c) => c.occupation_id === oid)).filter((c): c is typeof a.careers.careers[number] => !!c),
      ...a.careers.careers.filter((c) => !p.order.includes(c.occupation_id))]
    : a.careers.careers;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <h2 className="flex-1 text-2xl font-extrabold">{t("careers")}</h2>
        <SpeakButton text={ordered.map((c) => careerName(c.occupation_id)).join(", ")} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[...sectors].map((s) => <Pill key={s} tone="brand">{pick(SECTOR[s] ?? { en: s })}</Pill>)}
      </div>
      {personal === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted"><Icon name="spark" className="size-4 animate-pulse text-[#7c3aed]" />{t("personalising")}</p>
      )}
      {p?.ai && (
        <div className="flex items-start gap-2 rounded-xl bg-[#7c3aed]/10 px-3 py-2 text-sm">
          <Icon name="spark" className="mt-0.5 size-4 shrink-0 text-[#7c3aed]" />
          <span className="flex-1">{t("personalOrder", { n: p.order.length })}</span>
          <WhyButton subject={`order:${id}`} title={t("personalOrderTitle")} />
        </div>
      )}
      {ordered.map((c, i) => {
        const occ = kb.occupations[c.occupation_id];
        const recommended = a.recommendations.some((r) => r.payload.occupation_id === c.occupation_id);
        const mine = p?.why[c.occupation_id];
        const formulaRank = a.careers.careers.indexOf(c) + 1;
        return (
          <div
            key={c.occupation_id}
            role="button"
            tabIndex={0}
            onClick={() => go({ name: "career", id, occ: c.occupation_id })}
            onKeyDown={(e) => e.key === "Enter" && go({ name: "career", id, occ: c.occupation_id })}
            className="flex cursor-pointer flex-col gap-2 rounded-2xl bg-surface p-4 text-left border border-line active:bg-paper"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-paper text-2xl">{SECTOR[c.sector]?.emoji ?? "⭐"}</span>
              <div className="flex-1">
                <h3 className="text-lg leading-tight font-bold"><span className="mr-1.5 font-mono text-sm text-accent-dark">{String(i + 1).padStart(2, "0")}</span>{pick(occ.name)}</h3>
                <p className="text-sm text-muted">
                  {pick(SECTOR[c.sector] ?? { en: c.sector })}
                  {p?.ai && formulaRank !== i + 1 && i < TOP ? ` · ${t("formulaRank", { n: formulaRank })}` : ""}
                </p>
              </div>
              <Icon name="chevron" className="size-5 text-faint" />
            </div>
            {recommended && <Pill tone="good"><Icon name="star" className="size-3.5" />{t("recommended")}</Pill>}
            {mine && (
              <div className="rounded-xl border-l-4 border-[#7c3aed] bg-[#7c3aed]/5 px-3 py-2">
                <p className="text-sm font-semibold">{t("whyFitsYou")}</p>
                <p className="text-sm">{mine.why}</p>
                {mine.quote && <p className="mt-1 text-xs text-muted">“{mine.quote}”</p>}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Bar label={t("skillMatch")} value={c.parts.fit} />
              <Bar label={t("reachable")} value={c.parts.reach} />
              <Bar label={t("interestFit")} value={c.parts.worth} />
            </div>
            {c.could_learn && <Pill tone="sun"><Icon name="spark" className="size-3.5" />{t("couldLearn")}</Pill>}
            {c.matched_skills.length > 0 && (
              <p className="text-sm text-muted">{t("whyFits")}: {c.matched_skills.map((s) => pick(kb.skills[s].name)).join(", ")}</p>
            )}
            <div className="flex justify-end"><WhyButton subject={`career:${c.occupation_id}`} title={pick(occ.name)} /></div>
          </div>
        );
      })}

      <WiderOptions a={a} go={go} id={id} />

      {a.careers.what_if.length > 0 && (
        <div className="rounded-2xl bg-sun-soft p-4">
          <h3 className="flex items-center gap-2 text-lg font-bold"><Icon name="bulb" className="size-5" />{t("whatIf")}</h3>
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

/**
 * "Wider options": the AI suggests careers she may not have thought of, but only ids from our catalogue.
 * A rule drops anything else, and the same Fit + Reach + Worth formula scores what is left. Offline, a rule
 * picks the best-scoring careers from sectors not yet in her list instead.
 */
function WiderOptions({ a, go, id }: { a: Analysis; go: Go; id: string }) {
  const { t, pick, lang } = useT();
  const [ideas, setIdeas] = useState<{ id: string; why: string; score: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const shown = new Set(a.careers.careers.map((c) => c.occupation_id));

  const load = async () => {
    setBusy(true);
    const res = await careerIdeasRemote({
      riasec: a.persona.riasec as Record<string, number> | undefined, skills: a.skills.map((s) => s.id), education: a.persona.education, exclude: [...shown],
    }, lang);
    const all = new Map(scoreAllV2(kb, a.personaV2).map((c) => [c.occupation_id, c.score]));
    if (res && res.source !== "unavailable") {
      // Rule check on the phone too: only catalogue ids, not already shown.
      const kept = res.ideas.filter((x) => kb.occupations[x.id] && !shown.has(x.id));
      const dropped = [...(res.trace?.dropped ?? []), ...res.ideas.filter((x) => !kb.occupations[x.id]).map((x) => ({ value: x.id, reason: "not in the career catalogue" }))];
      const out = kept.map((x) => ({ ...x, score: all.get(x.id) ?? 0 })).sort((p, q) => q.score - p.score);
      emit({
        step: "careers", source: "AI_CHECKED", ref: "ai.suggest_careers", title: `AI suggested ${res.ideas.length + (res.trace?.dropped?.length ?? 0)} wider careers, ${out.length} kept`, subject: `wider:${id}`,
        inputs: { interests: JSON.stringify(a.persona.riasec ?? {}), skills: a.skills.map((s) => s.id).join(", ") || "none" },
        output: out.map((x) => kb.occupations[x.id].name.en).join(", ") || "none",
        why: [...out.map((x) => `${x.id} ✓ in catalogue → scored by formula: ${x.score.toFixed(2)}`), ...dropped.map((d) => `${d.value} ✗ ${d.reason}`), "the AI does not rank: order is by the Fit + Reach + Worth score"],
        ai: { model: res.trace?.model ?? "gemini", latency_ms: res.trace?.latency_ms, kept: out.map((x) => x.id), dropped, cached: res.trace?.cached },
      });
      for (const x of out) { const b = explainCareer(kb, a.personaV2, x.id); if (b) emit(careerDecision(b, kb.occupations[x.id].name.en)); }
      setIdeas(out);
      setOffline(false);
    } else {
      const sectors = new Set(a.careers.careers.map((c) => c.sector));
      const ranked = scoreAllV2(kb, a.personaV2).filter((c) => !shown.has(c.occupation_id));
      const other = ranked.filter((c) => !sectors.has(c.sector));
      const out = (other.length ? other : ranked).slice(0, 4).map((c) => ({ id: c.occupation_id, why: "", score: c.score }));
      emit({ step: "careers", source: "RULE", ref: "formula.fitreach", title: "Wider careers offline: best scores from other sectors", subject: `wider:${id}`,
        output: out.map((x) => x.id).join(", "), why: ["no internet → no AI", "rule: top Fit + Reach + Worth scores from sectors not already in her list"] });
      setIdeas(out);
      setOffline(true);
    }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-dashed border-[#7c3aed]/50 bg-surface p-4">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Icon name="spark" className="size-5 text-[#7c3aed]" />{t("widerOptions")}</h3>
      <p className="text-sm text-muted">{t("widerHint")}</p>
      {!ideas && <Button kind="soft" className="mt-3 w-full" disabled={busy} onClick={load}>{busy ? t("thinking") : t("getIdeas")}</Button>}
      {offline && <p className="mt-2 text-xs text-warn">{t("ideasOffline")}</p>}
      {ideas && (
        <ul className="mt-3 flex flex-col gap-2">
          {ideas.map((x) => (
            <li key={x.id}>
              <button onClick={() => go({ name: "career", id, occ: x.id })} className="flex w-full items-start gap-3 rounded-xl border border-line p-3 text-left">
                <span className="text-2xl">{SECTOR[kb.occupations[x.id].sector]?.emoji ?? "⭐"}</span>
                <span className="flex-1">
                  <span className="block font-bold">{pick(kb.occupations[x.id].name)}</span>
                  {x.why && <span className="block text-sm text-muted">{x.why}</span>}
                </span>
                <span className="font-mono text-sm text-accent-dark">{x.score.toFixed(2)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const { t, lang } = useT();
  const catalog = useSchemeCatalog();
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
      <h2 className="flex items-center gap-2 text-2xl font-extrabold"><Icon name="check" className="size-6 text-good" />{t("eligibleNow")}</h2>
      {now.length ? now.map((s) => <SchemeCard key={s.scheme_id} s={s} recommended={recommendedIds.has(s.scheme_id)} />) : <p className="text-muted">{t("noneNow")}</p>}

      {nextFacts.length > 0 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-sun bg-surface p-4">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Icon name="question" className="size-5 text-warn" />{t("needInfo")}</h2>
          {nextFacts.map((f) => (
            <FactQuestionView key={f} q={FACT_QUESTIONS[f]} value={student.factAnswers[f]} onChange={(v) => setFact(f, v)} />
          ))}
        </div>
      )}

      {later.length > 0 && (
        <>
          <h2 className="mt-2 flex items-center gap-2 text-2xl font-extrabold"><Icon name="hourglass" className="size-6 text-muted" />{t("eligibleLater")}</h2>
          {later.map((s) => <SchemeCard key={s.scheme_id} s={s} later recommended={recommendedIds.has(s.scheme_id)} />)}
        </>
      )}

      <p className="text-center text-xs text-muted">
        {catalog.source === "bundled" ? t("schemesBundled", { n: catalog.count })
          : t("schemesFetched", { n: catalog.count, date: formatDate(new Date(catalog.fetched_at ?? Date.now()).toISOString().slice(0, 10), lang) })}
      </p>
    </section>
  );
}

function SchemeCard({ s, later, recommended }: { s: SchemeResult; later?: boolean; recommended?: boolean }) {
  const { t, pick, lang } = useT();
  const [open, setOpen] = useState(false);
  const scheme = kb.schemes[s.scheme_id];
  return (
    <article className={`rounded-2xl p-4 border border-line ${later ? "bg-surface/70" : "bg-surface"}`}>
      <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-paper text-2xl">{SCHEME_TYPE[s.type] ?? "📄"}</span>
        <div className="flex-1">
          <h3 className="text-lg leading-tight font-semibold">{pick(s.name)}</h3>
          {later && s.eligible_if && <p className="text-sm font-medium text-warn">{t("afterJoining", { stage: t(`stage_${s.eligible_if.stage}` as Parameters<typeof t>[0]) })}</p>}
          {recommended && <Pill tone="good"><Icon name="star" className="size-3.5" />{t("recommended")}</Pill>}
        </div>
        <Icon name={open ? "chevronDown" : "chevron"} className="size-5 text-faint" />
      </button>
      <p className="mt-2">{s.benefit_en}</p>
      <div className="mt-2 flex justify-end"><WhyButton subject={`scheme:${s.scheme_id}`} title={pick(s.name)} /></div>
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
  if (given) return <p className="flex items-center justify-center gap-2 text-center font-medium text-good"><Icon name="check" className="size-4" />{t("thanks")}</p>;
  const send = (helpful: boolean) => addAction({ student_id: studentId, kind: "feedback", payload: { tab, helpful }, by: "student" });
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl bg-surface p-3">
      <span className="font-medium">{t("wasHelpful")}</span>
      <button onClick={() => send(true)} className="flex size-11 items-center justify-center rounded-full border border-line text-good hover:bg-good-soft" aria-label="Yes"><Icon name="up" className="size-5" /></button>
      <button onClick={() => send(false)} className="flex size-11 items-center justify-center rounded-full border border-line text-muted hover:bg-paper" aria-label="No"><Icon name="down" className="size-5" /></button>
    </div>
  );
}
