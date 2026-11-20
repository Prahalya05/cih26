import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Progress, Screen, SpeakButton, useLive } from "../components/ui";
import { CARDS } from "../data/cards";
import { db, patchStudent } from "../lib/db";
import { recordEvent } from "../lib/events";
import { useT } from "../lib/i18n";
import { speak } from "../lib/speech";
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

  const answer = async (like: boolean) => {
    await patchStudent(id, (s) => ({ ...s, cards: { ...s.cards, [card.id]: like } }));
    await recordEvent({ student_id: id, kind: "interest_choice", payload: { card: card.id, like } });
    setIndex(index + 1);
  };

  return (
    <Screen title={t("cardsTitle")} onBack={() => (index > 0 ? setIndex(index - 1) : go({ name: "home" }))}>
      <Progress step={index} total={CARDS.length} />
      <p className="text-center text-muted">{t("cardsHint")}</p>
      <div key={card.id} className="pop flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl bg-surface p-6 border border-line">
        <span className="text-[7rem] leading-none">{card.emoji}</span>
        <p className="text-center text-2xl font-semibold">{pick(card)}</p>
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
    </Screen>
  );
}
