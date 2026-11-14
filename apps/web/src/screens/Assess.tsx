
// A short adaptive test for one sub-skill. Each answer is saved as an event straight away, so leaving
// and coming back continues the same session (answers from today are replayed to rebuild it).

import { useEffect, useMemo, useState } from "react";
import { nextItem, prior, seededRandom, shouldStop, update, type ItemParams, type UnitState } from "@disha/engine";
import type { Go } from "../App";
import { ItemView, SUPPORTED_FORMATS, type ItemAnswer, type QuestionItem } from "../components/Items";
import { Button, Pill, Progress, Screen, useLive } from "../components/ui";
import { db } from "../lib/db";
import { recordEvent } from "../lib/events";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { ITEMS, profileOf } from "../lib/skills";

type BankItem = ItemParams & QuestionItem & { subskill: string };
const DAY = 86_400_000;

export default function Assess({ go, id, subskill }: { go: Go; id: string; subskill: string }) {
  const { t, pick } = useT();
  const sub = kb.graph!.subskills[subskill];

  const bank = useMemo(() => Object.values(ITEMS).filter(
    (it) => it.subskill === subskill && SUPPORTED_FORMATS.includes(String(it.format)) && !(it as { retired?: boolean }).retired) as BankItem[],
    [subskill]); // retired questions are still scored, never asked

  const today = Math.floor(Date.now() / DAY);

  const answers = useLive(async () => (await db.events.where("student_id").equals(id).toArray())
    .filter((e) => e.kind === "item_response" && e.subskill_id === subskill && Math.floor(e.created_at / DAY) === today)
    .sort((a, b) => (a.id < b.id ? -1 : 1)), [id, subskill], null);

  const [result, setResult] = useState<UnitState | null>(null);
  const [saving, setSaving] = useState(false);

  // Rebuild the session from today's answers: posterior, items seen, formats asked.
  const session = useMemo(() => {
    if (!answers) return null;

    let post = prior();
    const seen = new Set<string>();
    const formats: string[] = [];

    for (const e of answers) {
      const item = ITEMS[e.item_id ?? ""];
      if (!item) continue;
      post = update(post, item, e.payload.correct === true);
      seen.add(item.id);
      formats.push(String(item.format));
    }

    const done = shouldStop(post, seen.size, bank.length - seen.size, sub.cuts);

    // Same seed for the whole day, so a reload shows the same next question.
    const rand = seededRandom(hashSeed(`${id}|${subskill}|${today}`));
    for (let i = 0; i < seen.size; i++) rand();

    const next = done ? null : (nextItem(post, bank, seen, rand, formats) as BankItem | null);

    return { post, seen, next, done, asked: seen.size };
  }, [answers, bank, id, subskill, today, sub.cuts]);

  useEffect(() => {
    if (session?.done) void profileOf(id).then((p) => setResult(p.units[subskill] ?? null));
  }, [session?.done, id, subskill]);

  if (!sub || !session) return null;

  const onAnswer = async (a: ItemAnswer) => {
    if (!session.next || saving) return;

    setSaving(true);

    await recordEvent({
      student_id: id,
      kind: "item_response",
      subskill_id: subskill,
      item_id: session.next.id,
      payload: {
        correct: a.correct,
        ms: a.ms,
        value: a.value as never,
        ...(a.ms < 1500 ? { fast: true } : {}),
      },
    });

    setSaving(false);
  };

  const back = () => go({ name: "results", id, tab: "strengths" });

  if (session.done) {
    const levelName = result
      ? `${t("levelN", { n: result.level })}: ${t(`level${result.level}` as "level1")}`
      : "…";

    return (
      <Screen title={pick(sub.name)} onBack={back}>
        <div className="flex flex-1 flex-col justify-center gap-5">
          <div className="overflow-hidden rounded-[2rem] border border-line bg-white shadow-sm">
            <div className="bg-brand/10 px-6 py-8 text-center">
              <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-white text-6xl shadow-sm">
                🎉
              </div>

              <h2 className="mt-5 text-2xl font-bold leading-snug">
                {t("testDone", { level: levelName, name: pick(sub.name) })}
              </h2>

              {result && (
                <p className="mt-3 text-sm font-medium text-muted">
                  {t("sure", { pct: Math.round(result.confidence * 100) })}
                </p>
              )}

              {result?.strong && (
                <div className="mt-4">
                  <Pill tone="good">💪 {t("strong")}</Pill>
                </div>
              )}
            </div>

            <div className="p-5">
              <p className="rounded-2xl bg-sun-soft p-4 text-center text-sm leading-relaxed text-warn">
                {t("testDoneNext")}
              </p>
            </div>
          </div>

          <Button className="w-full" onClick={back}>
            {t("done")} →
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={pick(sub.name)} onBack={back}>
      <div className="rounded-[1.5rem] border border-line bg-white p-4 shadow-sm">
        <Progress step={session.asked} total={8} />
      </div>

      {session.asked === 0 && (
        <div className="rounded-2xl border border-line bg-brand/10 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-2xl">
              💡
            </span>
            <p className="pt-1 text-sm leading-relaxed text-muted">
              {t("testHint")}
            </p>
          </div>
        </div>
      )}

      {session.next && (
        <div className="flex flex-1 flex-col rounded-[2rem] border border-line bg-white p-3 shadow-sm">
          <ItemView
            key={session.next.id}
            item={session.next}
            seed={id}
            onAnswer={onAnswer}
          />
        </div>
      )}
    </Screen>
  );
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
