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
  const bank = useMemo(() => Object.values(ITEMS).filter((it) => (it as unknown as GameItem).domain === domain) as unknown as GameItem[], [domain]);
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
    return { post, seen, started, done, next: done ? null : (nextItem(post, bank, seen, rand, formats) as GameItem | null) };
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
      student_id: id, kind: "aptitude_response", item_id: session.next.id,
      payload: { domain, correct: a.correct, ms: a.ms },
    });
  };

  if (session.done) {
    const theta = eap(session.post);
    const msg = theta > 0.8 ? t("gameStrong") : theta > -0.3 ? t("gameGood") : t("gameThanks");
    return (
      <Screen title={pick(apt.name)} onBack={back}>
        <div className="rounded-3xl bg-white p-6 text-center shadow-sm">
          <p className="text-5xl">{theta > 0.8 ? "🌟" : "🎉"}</p>
          <h2 className="mt-3 text-2xl font-bold">{msg}</h2>
          <p className="mt-2 text-muted">{t("gameAnswered", { n: session.seen.size })}</p>
        </div>
        <Button onClick={back}>{t("done")}</Button>
      </Screen>
    );
  }

  const secondsLeft = session.started === null ? GAME_SECONDS : Math.max(0, GAME_SECONDS - Math.floor((now - session.started) / 1000));
  return (
    <Screen title={pick(apt.name)} onBack={back}
      right={<span className="rounded-full bg-sun-soft px-3 py-1 text-sm font-semibold text-warn">⏱ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</span>}>
      {session.seen.size === 0 && <p className="text-muted">{t("gameHint")}</p>}
      <div className="relative">
        {session.next && <ItemView key={session.next.id} item={session.next} seed={id} onAnswer={onAnswer} />}
        {cheer && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl animate-bounce">✨</div>}
      </div>
    </Screen>
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
