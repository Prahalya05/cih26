import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Progress, Screen, SpeakButton, useLive } from "../components/ui";
import { CARDS } from "../data/cards";
import { db, patchStudent } from "../lib/db";
import { recordEvent } from "../lib/events";
import { useT } from "../lib/i18n";
import { speak } from "../lib/speech";
import { emit } from "../lib/xray";
import { Icon } from "../components/Icon";

export default function Cards({ go, id }: { go: Go; id: string }) {
  const { t, pick, lang } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    if (student && index === null) {
      const first = CARDS.findIndex((c) => !(c.id in student.cards));
      setIndex(first === -1 ? CARDS.length : first);
    }
  }, [student, index]);

  const card = index !== null ? CARDS[index] : undefined;
  useEffect(() => {
    if (card) speak(pick(card), lang, `card_${card.id}`);
  }, [card, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const finished = index !== null && !card;
  useEffect(() => {
    if (finished) go({ name: "questions", id });
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!student || index === null || !card) return null;

  const skipToWords = () => go({ name: "talk", id });
  const dontKnow = async () => {
    emit({ step: "interests", source: "RULE", ref: "rule.interest_unknown", title: "She chose 'I don't know yet'", subject: `interests:${id}`,
      output: "interests not guessed", why: ["no interests given → nothing is guessed", "interest part of Worth = 0 for every career"] });
    await patchStudent(id, (s) => ({ ...s, interests: { mode: "skipped", at: Date.now() } }));
    await recordEvent({ student_id: id, kind: "interest_choice", payload: { card: "skipped", like: false, mode: "skipped" } });
    go({ name: "questions", id });
  };
  const picture = student.uiMode === "picture";

  const answer = async (like: boolean) => {
    await patchStudent(id, (s) => ({ ...s, cards: { ...s.cards, [card.id]: like } }));
    await recordEvent({ student_id: id, kind: "interest_choice", payload: { card: card.id, like } });
    setIndex(index + 1);
  };

  return (
    <Screen title={t("cardsTitle")} onBack={() => (index > 0 ? setIndex(index - 1) : go({ name: "home" }))}>
      <Progress step={index} total={CARDS.length} />
      {!picture && <p className="text-center text-muted">{t("cardsHint")}</p>}
      <div key={card.id} className="pop flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl bg-surface p-6 border border-line">
        <span className="text-[7rem] leading-none">{card.emoji}</span>
        <p className={`text-center font-semibold ${picture ? "text-xl text-muted" : "text-2xl"}`}>{pick(card)}</p>
        <SpeakButton text={pick(card)} audioKey={`card_${card.id}`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => answer(false)} className="flex min-h-20 flex-col items-center justify-center rounded-2xl border border-line bg-surface text-lg font-semibold active:bg-paper">
          <Icon name="down" className="size-8" />{t("dislike")}
        </button>
        <button onClick={() => answer(true)} className="flex min-h-20 flex-col items-center justify-center rounded-2xl bg-brand text-lg font-semibold text-white active:bg-brand-dark">
          <Icon name="up" className="size-8" />{t("like")}
        </button>
      </div>
      {/* Always visible: she never has to use the cards. */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={skipToWords} className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent bg-brand-soft/60 px-2 text-sm font-bold text-accent-dark">
          <Icon name="mic" className="size-4" />{t("skipCards")}
        </button>
        <button onClick={dontKnow} className="min-h-12 rounded-xl border border-line bg-surface px-2 text-sm font-bold text-muted">🤷 {t("dontKnowYet")}</button>
      </div>
    </Screen>
  );
}
