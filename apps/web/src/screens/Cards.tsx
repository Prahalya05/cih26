
import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Progress, Screen, SpeakButton, useLive } from "../components/ui";
import { CARDS } from "../data/cards";
import { db, patchStudent } from "../lib/db";
import { recordEvent } from "../lib/events";
import { useT } from "../lib/i18n";
import { speak } from "../lib/speech";

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
    await patchStudent(id, (s) => ({
      ...s,
      cards: { ...s.cards, [card.id]: like },
    }));

    await recordEvent({
      student_id: id,
      kind: "interest_choice",
      payload: { card: card.id, like },
    });

    setIndex(index + 1);
  };

  const progress = Math.round(((index + 1) / CARDS.length) * 100);

  return (
    <Screen
      title={t("cardsTitle")}
      onBack={() =>
        index > 0
          ? setIndex(index - 1)
          : go({ name: "home" })
      }
    >
      {/* Progress section */}
      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[#77658F]">
            {t("cardsTitle")}
          </span>

          <span className="rounded-full bg-[#F2ECFA] px-3 py-1 text-sm font-bold text-[#8062A5]">
            {index + 1} / {CARDS.length}
          </span>
        </div>

        <Progress step={index} total={CARDS.length} />

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F3EDF9]">
          <div
            className="h-full rounded-full bg-[#A98BCB] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Instruction */}
      <div className="py-2 text-center">
        <p className="text-base font-medium leading-relaxed text-[#766C82]">
          {t("cardsHint")}
        </p>
      </div>

      {/* Interest card */}
      <div
        key={card.id}
        className="pop relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-[2rem] border border-[#EDE3F6] bg-white px-6 py-8 shadow-[0_8px_30px_rgba(130,100,160,0.09)]"
      >
        {/* Decorative background circles */}
        <div className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-[#FCEBF2] opacity-70" />
        <div className="pointer-events-none absolute -bottom-16 -left-12 size-48 rounded-full bg-[#F0EAF9] opacity-80" />

        <div className="relative z-10 flex w-full flex-col items-center gap-6">
          {/* Emoji */}
          <div className="flex size-44 items-center justify-center rounded-full border-4 border-white bg-gradient-to-br from-[#FCEAF1] to-[#F0E8FA] shadow-md">
            <span className="text-[6.5rem] leading-none" role="img">
              {card.emoji}
            </span>
          </div>

          {/* Interest name */}
          <div className="max-w-sm text-center">
            <h2 className="text-2xl font-bold leading-snug text-[#493B59]">
              {pick(card)}
            </h2>

            <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-[#E8D8F4]" />
          </div>

          {/* Speech button */}
          <div className="rounded-2xl bg-[#F7F2FB] px-5 py-2">
            <SpeakButton
              text={pick(card)}
              audioKey={`card_${card.id}`}
            />
          </div>
        </div>
      </div>

      {/* Like / Dislike buttons */}
      <div className="grid grid-cols-2 gap-4 pt-2">
        <button
          onClick={() => answer(false)}
          className="group flex min-h-24 flex-col items-center justify-center gap-1 rounded-[1.5rem] border-2 border-[#F2D8E3] bg-[#FFF1F5] text-[#A65373] shadow-sm transition-all duration-200 hover:-translate-y-1 hover:bg-[#FCE5ED] active:scale-95"
        >
          <span className="text-4xl transition-transform duration-200 group-hover:scale-110">
            👎
          </span>

          <span className="text-base font-bold">
            {t("dislike")}
          </span>
        </button>

        <button
          onClick={() => answer(true)}
          className="group flex min-h-24 flex-col items-center justify-center gap-1 rounded-[1.5rem] border-2 border-[#CDB9E3] bg-[#EDE3F7] text-[#654B87] shadow-sm transition-all duration-200 hover:-translate-y-1 hover:bg-[#E4D5F2] active:scale-95"
        >
          <span className="text-4xl transition-transform duration-200 group-hover:scale-110">
            👍
          </span>

          <span className="text-base font-bold">
            {t("like")}
          </span>
        </button>
      </div>
    </Screen>
  );
}
