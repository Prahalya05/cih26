// A short adaptive test for one sub-skill. Each answer is saved as an event straight away, so leaving
// and coming back continues the same session (answers from today are replayed to rebuild it).
//
// Fair-test check: before the first question she can turn on the front camera (lib/proctor.ts). Faces, a second
// phone, books, leaving the app and pasting are noticed on the phone; each answer carries only the names of the
// warnings active while it was on screen. Scoring is unchanged: the teacher decides what a warning means.

import { useEffect, useMemo, useRef, useState } from "react";
import { nextItem, prior, seededRandom, shouldStop, update, type ItemParams, type UnitState } from "@disha/engine";
import type { Go } from "../App";
import { Icon } from "../components/Icon";
import { ItemView, SUPPORTED_FORMATS, type ItemAnswer, type QuestionItem } from "../components/Items";
import { Button, Card, Pill, Progress, Screen, useLive } from "../components/ui";
import { db } from "../lib/db";
import { recordEvent } from "../lib/events";
import { useT } from "../lib/i18n";
import { integrityOf, SERIOUS, type Flag } from "../lib/integrity";
import { kb } from "../lib/kb";
import type { Proctor } from "../lib/proctor";
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
  const check = useFairCheck();
  const shownAt = useRef(Date.now());

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

  useEffect(() => { shownAt.current = Date.now(); }, [session?.next?.id, check.state]);
  useEffect(() => { if (session?.done) check.stop(); }, [session?.done]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (session?.done) void profileOf(id).then((p) => setResult(p.units[subskill] ?? null));
  }, [session?.done, id, subskill]);

  if (!sub || !session) return null;

  const onAnswer = async (a: ItemAnswer) => {
    if (!session.next || saving) return;
    setSaving(true);
    const p = check.proctor;
    const flags = p ? p.flagsSince(shownAt.current) : [];
    await recordEvent({
      student_id: id, kind: "item_response", subskill_id: subskill, item_id: session.next.id,
      payload: {
        correct: a.correct, ms: a.ms, value: a.value as never, ...(a.ms < 1500 ? { fast: true } : {}),
        ...(p ? { checked: p.mode } : {}),
        ...(flags.length ? { integrity: flags } : {}),
      },
    });
    setSaving(false);
  };

  const back = () => { check.stop(); go({ name: "results", id, tab: "strengths" }); };

  if (session.done) {
    const fair = integrityOf(answers ?? [])[0];
    return (
      <Screen title={pick(sub.name)} onBack={back}>
        <Card className="pop p-6">
          <p className="eyebrow">{t("done")}</p>
          <h2 className="mt-1 text-2xl leading-snug font-extrabold">
            {result ? t("testDone", { level: `${t("levelN", { n: result.level })}: ${t(`level${result.level}` as "level1")}`, name: pick(sub.name) }) : "…"}
          </h2>
          {result && (
            <>
              <div className="mt-5 flex gap-1.5" aria-hidden>
                {[1, 2, 3, 4].map((L) => (
                  <div key={L} className={`h-2 flex-1 rounded-full ${L <= result.level ? "bg-accent" : "bg-line"}`} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>{t("sure", { pct: Math.round(result.confidence * 100) })}</span>
                {result.strong && <Pill tone="good"><Icon name="award" className="size-3.5" />{t("strong")}</Pill>}
              </div>
            </>
          )}
        </Card>
        {fair && <FairSummary flagged={fair.flagged} total={fair.answers} mode={fair.mode} serious={fair.serious} />}
        <p className="flex gap-3 rounded-2xl bg-brand-soft p-4 text-brand"><Icon name="next" className="mt-0.5" />{t("testDoneNext")}</p>
        <Button onClick={back}>{t("done")}</Button>
      </Screen>
    );
  }

  if (check.state !== "on") {
    return (
      <Screen title={pick(sub.name)} onBack={back}>
        <FairCheckGate state={check.state} onCamera={() => void check.start(true)} onSkip={() => void check.start(false)} />
      </Screen>
    );
  }

  return (
    <Screen title={pick(sub.name)} onBack={back}>
      <Monitor check={check} />
      <Progress step={session.asked} total={8} />
      {session.asked === 0 && <p className="text-muted">{t("testHint")}</p>}
      {session.next && <ItemView key={session.next.id} item={session.next} seed={id} onAnswer={onAnswer} />}
    </Screen>
  );
}

type FairState = "ask" | "starting" | "failed" | "on";

/** Starts and stops the fair-test check. The vision code is downloaded only when a test opens. */
function useFairCheck() {
  const [state, setState] = useState<FairState>("ask");
  const [proctor, setProctor] = useState<Proctor | null>(null);
  const [active, setActive] = useState<Flag[]>([]);
  const ref = useRef<Proctor | null>(null);
  useEffect(() => () => ref.current?.close(), []);
  const begin = (p: Proctor) => {
    ref.current = p;
    setProctor(p);
    p.subscribe(() => setActive(p.active()));
    setState("on");
  };
  const start = async (camera: boolean) => {
    setState("starting");
    const { startProctor } = await import("../lib/proctor");
    try {
      begin(await startProctor({ camera }));
    } catch {
      // Camera refused or the face model could not load: say so, then carry on with browser signals only.
      setState("failed");
      await new Promise((r) => setTimeout(r, 2200));
      begin(await startProctor({ camera: false }));
    }
  };
  const stop = () => { ref.current?.close(); ref.current = null; setActive([]); };
  return { state, proctor, active, start, stop };
}

function FairCheckGate({ state, onCamera, onSkip }: { state: FairState; onCamera: () => void; onSkip: () => void }) {
  const { t } = useT();
  const busy = state === "starting" || state === "failed";
  return (
    <>
      <div className="pop flex flex-col gap-4 pt-2">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-brand text-accent">
          <Icon name="scan" className="size-8" strokeWidth={1.6} />
        </div>
        <div>
          <p className="eyebrow">{t("testTitle")}</p>
          <h2 className="text-2xl font-extrabold">{t("fairCheckTitle")}</h2>
        </div>
        <p className="leading-relaxed text-muted">{t("fairCheckBody")}</p>
        <ol className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {(["fairRule1", "fairRule2", "fairRule3"] as const).map((k, i) => (
            <li key={k} className="flex items-center gap-4 px-4 py-3">
              <span className="font-mono text-sm font-bold text-accent-dark">0{i + 1}</span>
              <span className="font-medium">{t(k)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-auto flex flex-col gap-2 pt-4">
        {state === "failed" && <p className="flex gap-2 rounded-xl bg-sun-soft p-3 text-sm text-warn"><Icon name="alert" />{t("fairCheckFailed")}</p>}
        <Button disabled={busy} onClick={onCamera}>
          <Icon name="camera" />{state === "starting" ? t("fairCheckStarting") : t("fairCheckStart")}
        </Button>
        <Button kind="ghost" disabled={busy} onClick={onSkip}>{t("fairCheckSkip")}</Button>
        <p className="text-center text-xs text-muted">{t("fairCheckSkipNote")}</p>
      </div>
    </>
  );
}

/** The live strip above the question: a small mirrored camera picture and the current warning, if any. */
function Monitor({ check }: { check: ReturnType<typeof useFairCheck> }) {
  const { t } = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const p = check.proctor;
  useEffect(() => {
    p?.attach(canvas.current);
    return () => p?.attach(null);
  }, [p]);
  if (!p) return null;
  // "Left Disha" can only be seen after coming back, so it is recorded but not shown live.
  const live = check.active.filter((f) => f !== "tab_away");
  const top = [...live].sort((a, b) => Number(SERIOUS.has(b)) - Number(SERIOUS.has(a)))[0];
  const camera = p.mode === "camera";
  return (
    <div role="status" aria-live="polite"
      className={`sticky top-[68px] z-10 flex items-center gap-3 rounded-2xl border p-2 pr-3 transition-colors ${
        top ? "border-bad/40 bg-bad-soft" : "border-line bg-surface/95 backdrop-blur"}`}>
      {camera ? (
        <div className={`relative h-14 w-[74px] shrink-0 overflow-hidden rounded-xl bg-brand-dark ${top ? "pulse-ring" : ""}`}>
          <canvas ref={canvas} className="size-full object-cover" />
          <span className="absolute top-1 left-1 size-2 rounded-full bg-bad shadow-[0_0_0_2px_rgb(255_255_255/0.8)]" />
        </div>
      ) : (
        <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-paper text-muted"><Icon name="eyeOff" /></div>
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-bold ${top ? "text-bad" : "text-ink"}`}>
          {top ? t(`flag_${top}` as "flag_phone") : camera ? t("fairAllClear") : t("fairBrowserOnly")}
        </p>
        <p className="truncate text-xs text-muted">{camera ? t("fairPrivate") : t("fairCheckSkipNote")}</p>
      </div>
      <Icon name={top ? "alert" : "shield"} className={`size-5 ${top ? "text-bad" : "text-accent-dark"}`} />
    </div>
  );
}

function FairSummary({ flagged, total, mode, serious }: { flagged: number; total: number; mode: string; serious: boolean }) {
  const { t } = useT();
  const off = mode !== "camera";
  const tone = flagged
    ? (serious ? "border-bad/30 bg-bad-soft text-bad" : "border-sun/40 bg-sun-soft text-warn")
    : off ? "border-line bg-surface text-muted" : "border-good/30 bg-good-soft text-good";
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 text-sm font-medium ${tone}`}>
      <Icon name={flagged ? "alert" : off ? "eyeOff" : "shield"} className="mt-0.5 size-5" />
      <div>
        <p>{flagged ? t("fairSummaryFlags", { n: flagged, total }) : off ? t("fairSummaryOff") : t("fairSummaryClean")}</p>
        {flagged > 0 && off && <p className="mt-1 opacity-80">{t("fairSummaryOff")}</p>}
      </div>
    </div>
  );
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
