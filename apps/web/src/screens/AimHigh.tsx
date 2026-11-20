// Aim High tab (inside Results): higher-study careers, which doors are still open from where she is,
// the Class 11 group decision, readiness from subject quizzes, and today's practice.

import { dueCards, doors, interestFit, monthsToExam, readiness, streamOptions, type Door, type Readiness, type Start } from "@disha/engine";
import type { Go } from "../App";
import { FactQuestionView } from "../components/FactQuestionView";
import { Icon } from "../components/Icon";
import { Pill, SpeakButton, useLive } from "../components/ui";
import { FACT_QUESTIONS, LEVEL_OPTIONS } from "../data/facts";
import { abilitiesOf, ageOf, dayNumber, loadAim, pw, startOfStudent } from "../lib/aim";
import { patchStudent, type Student } from "../lib/db";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import type { Analysis } from "../lib/profile";

export interface RankedDoor extends Door { fit: number; ready: Readiness; months: number }

/** Every track with its door status, interest fit and readiness, best first (her goal on top). */
export function rankDoors(student: Student, riasec: Partial<Record<string, number>> | undefined,ab: ReturnType<typeof abilitiesOf>, goal?: string) {
  const start = startOfStudent(student);
  const list: RankedDoor[] = doors(pw, start, ageOf(student)).map((d) => {
    const months = monthsToExam(start, d.route);
    return { ...d, months, fit: interestFit(d.track, riasec), ready: readiness(d.track, ab, months) };
  });
  const score = (d: RankedDoor) => (d.track.id === goal ? 10 : 0) + 0.6 * d.fit + 0.4 * d.ready.p;
  list.sort((x, y) => score(y) - score(x) || (x.track.id < y.track.id ? -1 : 1));
  return { start, open: list.filter((d) => d.status === "open"), shut: list.filter((d) => d.status !== "open") };
}

/** "Biology + Maths" rather than the full "Class 11–12: Biology + Maths group". */
export function shortNode(node: string, pick: (o: { en: string; ta?: string }) => string) {
  const group = node.startsWith("c12_") && FACT_QUESTIONS.stream.options!.find((o) => o.value === node.slice(4));
  return group ? pick(group) : pick(pw.nodes[node].name);
}

export function stageLabel(student: Student, start: Start, pick: (o: { en: string; ta?: string }) => string) {
  const level = LEVEL_OPTIONS.find((o) => o.value === student.factAnswers.level);
  const group = start.node !== "c10" ? pick(pw.nodes[start.node].name) : null;
  return [level ? pick(level) : null, group].filter(Boolean).join(" · ");
}

export function AimHigh({ a, go, id, student }: { a: Analysis; go: Go; id: string; student: Student }) {
  const { t, pick } = useT();
  const aim = useLive(() => loadAim(id), [id], null);
  if (!aim) return null;
  const ab = abilitiesOf(aim);
  const { start, open, shut } = rankDoors(student, a.persona.riasec, ab, aim.goal);
  const due = dueCards(aim.cards, dayNumber()).length;
  const claimed = new Set(a.skills.map((s) => s.id));

  const setFact = (key: string, v: unknown) =>
    void patchStudent(id, (s) => ({ ...s, factAnswers: { ...s.factAnswers, [key]: v } }));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-2xl font-extrabold">{t("aimTitle")}</h2>
          <p className="mt-1 text-muted">{t("aimIntro")}</p>
        </div>
        <SpeakButton text={`${t("aimTitle")}. ${open.slice(0, 4).map((d) => pick(d.track.name)).join(", ")}`} />
      </div>
      <StageLine student={student} start={start} />

      {start.needs && (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-sun bg-surface p-4">
          <p className="flex gap-2 font-semibold"><Icon name="question" className="mt-0.5 size-5 text-warn" />{t(start.needs === "stream" ? "aimNeedStream" : "aimNeedDegree")}</p>
          <FactQuestionView q={FACT_QUESTIONS[start.needs]} value={student.factAnswers[start.needs]} onChange={(v) => setFact(start.needs!, v)} />
        </div>
      )}

      {start.node === "c10" && !start.needs && <GroupChooser riasec={a.persona.riasec} />}

      <button onClick={() => go({ name: "aimQuiz", id, subject: "all", mode: "practice" })} disabled={!due}
        className={`flex items-center gap-3 rounded-2xl p-4 text-left ${due ? "bg-brand text-white active:bg-brand-dark" : "border border-line bg-surface"}`}>
        <span className={`flex size-10 items-center justify-center rounded-xl ${due ? "bg-white/10 text-accent" : "bg-paper text-muted"}`}><Icon name="refresh" className="size-6" /></span>
        <span className="flex-1">
          <span className="block text-lg font-semibold">{t("aimPractice")}</span>
          <span className={`block text-sm ${due ? "opacity-90" : "text-muted"}`}>{due ? t("aimDue", { n: due }) : t("aimNoneDue")}</span>
        </span>
        {due > 0 && <Icon name="chevron" className="size-6" />}
      </button>

      {open.map((d) => <TrackCard key={d.track.id} d={d} goal={aim.goal === d.track.id} claimed={claimed}
        onOpen={() => go({ name: "aimTrack", id, track: d.track.id })} />)}

      {shut.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-lg font-bold">{t("aimClosedTitle")} ({shut.length})</summary>
          <p className="mt-2 text-sm text-muted">{t("aimClosedHint")}</p>
          <div className="mt-3 flex flex-col gap-2">
            {shut.map((d) => <TrackCard key={d.track.id} d={d} goal={false} claimed={claimed}
              onOpen={() => go({ name: "aimTrack", id, track: d.track.id })} />)}
          </div>
        </details>
      )}
      <p className="text-xs text-muted">{t("aimCheckRules")}</p>
    </section>
  );
}

function StageLine({ student, start }: { student: Student; start: Start }) {
  const { t, pick } = useT();
  const stage = stageLabel(student, start, pick);
  if (!stage) return null;
  return <p className="flex items-center gap-2 text-sm font-semibold text-brand"><Icon name="target" className="size-4" />{t("aimYouAre", { stage })}</p>;
}

/** Class 10 decision: how many doors each next step keeps open, starred where it fits her interests best. */
function GroupChooser({ riasec }: { riasec: Partial<Record<string, number>> | undefined }) {
  const { t, pick } = useT();
  const options = streamOptions(pw, (tr) => interestFit(tr, riasec));
  const total = pw.tracks.length;
  const best = options[0];
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Icon name="layers" className="size-5 text-accent-dark" />{t("aimChooseGroup")}</h3>
      <p className="mt-1 text-sm text-muted">{t("aimChooseGroupHint")}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {options.map((o) => (
          <li key={o.node}>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm font-semibold">{pick(pw.nodes[o.node].name)}</p>
              {o === best && best.value > 0 && <Pill tone="good"><Icon name="star" className="size-3.5" />{t("aimBestForYou")}</Pill>}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 flex-1 rounded-full bg-line"><div className="h-2 rounded-full bg-brand" style={{ width: `${(o.open.length / total) * 100}%` }} /></div>
              <span className="w-24 text-right text-xs text-muted">{t("aimDoorsOpen", { n: o.open.length, total })}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TrackCard({ d, goal, claimed, onOpen }: { d: RankedDoor; goal: boolean; claimed: Set<string>; onOpen: () => void }) {
  const { t, pick } = useT();
  const tr = d.track;
  const examIds = [...new Set((d.route?.steps ?? []).flatMap((e) => e.exams ?? []))].slice(0, 3);
  const shows = tr.skills.filter((s) => claimed.has(s)).map((s) => pick(kb.skills[s].name));
  const via = d.via.length && d.via.length < (pw.out.c10?.length ?? 0) ? d.via.map((n) => shortNode(n, pick)) : [];
  return (
    <button onClick={onOpen} className={`flex flex-col gap-2 rounded-2xl border p-4 text-left active:bg-paper ${goal ? "border-accent bg-sun-soft" : "border-line bg-surface"}`}>
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-paper text-2xl">{tr.emoji}</span>
        <div className="flex-1">
          <h3 className="text-lg leading-tight font-bold">{pick(tr.name)}</h3>
          {d.route && <p className="text-sm text-muted">{t("aimYears", { years: d.route.years })}</p>}
        </div>
        <Icon name="chevron" className="size-5 text-faint" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {goal && <Pill tone="good"><Icon name="target" className="size-3.5" />{t("aimGoal")}</Pill>}
        {d.status !== "open" && <Pill tone="bad">{t(d.status === "age" ? "aimAge" : "aimClosed")}</Pill>}
        {d.ready.measured > 0 && d.status === "open" && <Pill tone={d.ready.band === "on_track" ? "good" : d.ready.band === "building" ? "sun" : "neutral"}>{t(`aimBand_${d.ready.band}`)}</Pill>}
        {examIds.map((x) => <Pill key={x}>{pw.exams[x].name}</Pill>)}
      </div>
      {via.length > 0 && <p className="text-sm text-muted">{t("aimVia", { groups: via.join(" / ") })}</p>}
      {shows.length > 0 && <p className="text-sm text-good">{t("aimYouShow", { skills: shows.join(", ") })}</p>}
    </button>
  );
}
