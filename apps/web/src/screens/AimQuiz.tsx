// Aim High subject check and daily practice.
//   check:    a short adaptive quiz for one subject (same 2PL item picker as the skill tests), up to 6 questions.
//   practice: the questions due today from her Leitner boxes, across subjects.
// After each answer she sees whether it was right and why: this screen teaches as well as measures.

import { useEffect, useMemo, useState } from "react";
import { dueCards, nextItem, prior, seededRandom, shouldStop, update } from "@disha/engine";
import type { Go } from "../App";
import { Icon } from "../components/Icon";
import { ItemView } from "../components/Items";
import { Button, Card, Pill, Progress, Screen, useLive } from "../components/ui";
import { abilitiesOf, AIM_ITEMS, dayNumber, loadAim, pw, recordAim, subjectItems } from "../lib/aim";
import { useT } from "../lib/i18n";

const MAX_CHECK = 6;
const MAX_PRACTICE = 8;

type Mode = "check" | "practice";

export default function AimQuiz({ go, id, subject, mode, track }: { go: Go; id: string; subject: string; mode: Mode; track?: string }) {
  const { t, pick } = useT();
  const aim = useLive(() => loadAim(id), [id], null);
  const [asked, setAsked] = useState<{ item: string; correct: boolean }[]>([]);
  const [last, setLast] = useState<{ item: string; correct: boolean } | null>(null);
  const [queue, setQueue] = useState<string[] | null>(null);
  const day = dayNumber();

  // Practice: fix today's list once, so answering does not reshuffle it.
  useEffect(() => {
    if (mode === "practice" && aim && queue === null) setQueue(dueCards(aim.cards, day).filter((i) => AIM_ITEMS[i]).slice(0, MAX_PRACTICE));
  }, [mode, aim, queue, day]);

  const bank = useMemo(() => (mode === "check" ? subjectItems(subject) : []), [mode, subject]);
  const next = useMemo(() => {
    if (mode === "practice") {
      if (!queue) return null;
      return AIM_ITEMS[queue[asked.length]] ?? null;
    }
    let post = prior();
    for (const a of asked) post = update(post, AIM_ITEMS[a.item], a.correct);
    const seen = new Set(asked.map((a) => a.item));
    if (asked.length >= MAX_CHECK || shouldStop(post, asked.length, bank.length - seen.size)) return null;
    const rand = seededRandom(hash(`${id}|${subject}|${day}|${asked.length}`));
    const it = nextItem(post, bank, seen, rand);
    return it ? AIM_ITEMS[it.id] : null;
  }, [mode, queue, asked, bank, id, subject, day]);

  const back = () => go(track ? { name: "aimTrack", id, track } : { name: "results", id, tab: "aim" });
  const title = mode === "practice" ? t("aimPractice") : pick(pw.subjects[subject]?.name ?? { en: subject });
  if (!aim || (mode === "practice" && queue === null)) return null;

  if (last) {
    const item = AIM_ITEMS[last.item];
    const answer = item.options.find((o) => o.id === item.answer)!;
    return (
      <Screen title={title} onBack={back}>
        <Card className={`pop flex flex-col gap-3 p-5 ${last.correct ? "border-good/40" : "border-sun/50"}`}>
          <p className={`flex items-center gap-2 text-xl font-extrabold ${last.correct ? "text-good" : "text-warn"}`}>
            <Icon name={last.correct ? "check" : "bulb"} className="size-6" />
            {last.correct ? t("aimRight") : t("aimWrong", { answer: pick(answer) })}
          </p>
          <p className="text-muted">{pick(item.prompt)}</p>
          <p className="rounded-xl bg-paper p-3">{pick(item.why)}</p>
        </Card>
        <Button onClick={() => setLast(null)}>{t("next")} →</Button>
      </Screen>
    );
  }

  if (!next) {
    const right = asked.filter((a) => a.correct).length;
    const ab = mode === "check" ? abilitiesOf(aim)[subject] : undefined;
    const lvl = ab && ab.n > 0 ? (ab.theta < 0 ? "low" : ab.theta < 1 ? "mid" : "high") : null;
    return (
      <Screen title={title} onBack={back}>
        <Card className="pop p-6">
          <p className="eyebrow">{t("done")}</p>
          <h2 className="mt-1 text-2xl font-extrabold">{mode === "check" ? t("aimQuizDone", { subject: title }) : t("aimPracticeDone")}</h2>
          {asked.length > 0 && <p className="mt-2 text-muted">{t("aimQuizScore", { right, n: asked.length })}</p>}
          {lvl && <div className="mt-3"><Pill tone={lvl === "high" ? "good" : lvl === "mid" ? "sun" : "neutral"}>{t(`aimLevel_${lvl}`)}</Pill></div>}
        </Card>
        <p className="flex gap-3 rounded-2xl bg-brand-soft p-4 text-brand"><Icon name="refresh" className="mt-0.5" />{t("aimPracticeHint")}</p>
        <Button onClick={back}>{t("done")}</Button>
      </Screen>
    );
  }

  const total = mode === "practice" ? queue!.length : Math.min(MAX_CHECK, bank.length);
  const onAnswer = async (correct: boolean) => {
    await recordAim(id, next.id, correct, mode);
    setAsked((a) => [...a, { item: next.id, correct }]);
    setLast({ item: next.id, correct });
  };

  return (
    <Screen title={title} onBack={back}>
      <Progress step={asked.length} total={total} />
      {asked.length === 0 && mode === "check" && <p className="text-muted">{t("aimQuizHint")}</p>}
      {mode === "practice" && <p className="text-sm text-muted">{pw.subjects[next.subject].emoji} {pick(pw.subjects[next.subject].name)}</p>}
      <ItemView key={next.id} item={next} seed={id} onAnswer={(a) => void onAnswer(a.correct)} />
    </Screen>
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
