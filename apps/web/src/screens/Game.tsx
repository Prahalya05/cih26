
 // A 3-minute puzzle game that measures one aptitude (spatial, number sense, mechanical).
// Adaptive like the skill tests; answers are saved as aptitude_response events as she plays.
// Right answers get a cheer; wrong ones simply move on (no buzzer).

import { useEffect, useMemo, useState } from "react";
import { eap, nextItem, prior, se, seededRandom, update, type ItemParams } from "@disha/engine";
import type { Go } from "../App";
import { ItemView, type ItemAnswer, type QuestionItem } from "../components/Items";
import { Button, Screen, useLive } from "../components/ui";
import { db } from "../lib/db";
import { recordEvent } from "../lib/events";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";
import { ITEMS } from "../lib/skills";

type GameItem = ItemParams & QuestionItem & { domain: string };
const DAY = 86_400_000;
export const GAME_SECONDS = 180;
const GAME_STOP_SE = 0.45;
const GAME_MAX_ITEMS = 14;
export const GAMES = [
  { domain: "apt_spatial", emoji: "🧩" },
  { domain: "apt_numeric", emoji: "🔢" },
  { domain: "apt_mechanical", emoji: "⚙️" },
];

export default function Game({ go, id, domain }: { go: Go; id: string; domain: string }) {
  const { t, pick } = useT();
  const apt = kb.graph!.aptitudes[domain];

  const bank = useMemo(() => Object.values(ITEMS).filter(
    (it) => (it as unknown as GameItem).domain === domain && !(it as { retired?: boolean }).retired
  ) as unknown as GameItem[], [domain]);

  const today = Math.floor(Date.now() / DAY);

  const answers = useLive(async () => (await db.events.where("student_id").equals(id).toArray())
    .filter((e) => e.kind === "aptitude_response" && e.payload.domain === domain && Math.floor(e.created_at / DAY) === today)
    .sort((a, b) => (a.id < b.id ? -1 : 1)), [id, domain], null);

  const [cheer, setCheer] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const session = useMemo(() => {
    if (!answers) return null;

    let post = prior(0, 1);
    const seen = new Set<string>();
    const formats: string[] = [];

    for (const e of answers) {
      const item = ITEMS[e.item_id ?? ""];
      if (!item) continue;
      post = update(post, item, e.payload.correct === true);
      seen.add(item.id);
      formats.push(String(item.format));
    }

    const started = answers[0]?.created_at ?? null;
    const rand = seededRandom(hash(`${id}|${domain}|${today}`));

    for (let i = 0; i < seen.size; i++) rand();

    const left = bank.length - seen.size;
    const timeUp = started !== null && now - started > GAME_SECONDS * 1000;
    const done = timeUp || seen.size >= GAME_MAX_ITEMS || left === 0 || (seen.size >= 5 && se(post) < GAME_STOP_SE);

    return {
      post,
      seen,
      started,
      done,
      next: done ? null : (nextItem(post, bank, seen, rand, formats) as GameItem | null),
    };
  }, [answers, bank, id, domain, today, now]);

  if (!apt || !session) return null;

  const back = () => go({ name: "results", id, tab: "strengths" });

  const onAnswer = async (a: ItemAnswer) => {
    if (!session.next) return;

    if (a.correct) {
      setCheer(true);
      window.setTimeout(() => setCheer(false), 700);
    }

    await recordEvent({
      student_id: id,
      kind: "aptitude_response",
      item_id: session.next.id,
      payload: { domain, correct: a.correct, ms: a.ms },
    });
  };

  if (session.done) {
    const theta = eap(session.post);
    const msg = theta > 0.8 ? t("gameStrong") : theta > -0.3 ? t("gameGood") : t("gameThanks");

    return (
      <Screen title={pick(apt.name)} onBack={back}>
        <div className="flex flex-1 flex-col justify-center gap-5">
          <div className="overflow-hidden rounded-[2rem] border border-line bg-white shadow-sm">
            <div className="bg-brand/10 px-6 py-9 text-center">
              <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-white text-6xl shadow-sm">
                {theta > 0.8 ? "🌟" : "🎉"}
              </div>

              <h2 className="mt-5 text-2xl font-bold leading-snug">
                {msg}
              </h2>

              <p className="mt-3 text-sm font-medium text-muted">
                {t("gameAnswered", { n: session.seen.size })}
              </p>
            </div>

            <div className="p-5">
              <p className="rounded-2xl bg-sun-soft p-4 text-center text-sm leading-relaxed text-warn">
                {t("gameHint")}
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

  const secondsLeft = session.started === null
    ? GAME_SECONDS
    : Math.max(0, GAME_SECONDS - Math.floor((now - session.started) / 1000));

  const isLowTime = secondsLeft <= 30;

  return (
    <Screen
      title={pick(apt.name)}
      onBack={back}
      right={
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold ${
          isLowTime ? "bg-red-100 text-red-700" : "bg-sun-soft text-warn"
        }`}>
          <span>⏱</span>
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </span>
      }
    >
      <div className="rounded-[1.5rem] border border-line bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-muted">
            {session.seen.size} / {GAME_MAX_ITEMS}
          </span>
          <span className="text-xs font-medium text-muted">
            {Math.floor(secondsLeft / 60)} min {secondsLeft % 60} sec
          </span>
        </div>

        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-brand/10">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${Math.min(100, (session.seen.size / GAME_MAX_ITEMS) * 100)}%` }}
          />
        </div>
      </div>

      {session.seen.size === 0 && (
        <div className="rounded-2xl border border-line bg-brand/10 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-2xl">
              💡
            </span>
            <p className="pt-1 text-sm leading-relaxed text-muted">
              {t("gameHint")}
            </p>
          </div>
        </div>
      )}

      <div className="relative flex flex-1 flex-col rounded-[2rem] border border-line bg-white p-3 shadow-sm">
        {session.next && (
          <ItemView
            key={session.next.id}
            item={session.next}
            seed={id}
            onAnswer={onAnswer}
          />
        )}

        {cheer && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[2rem] bg-white/30 text-7xl animate-bounce">
            ✨
          </div>
        )}
      </div>
    </Screen>
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
