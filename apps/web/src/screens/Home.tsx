import type { Go } from "../App";
import { Button, Screen, SpeakButton, useLive } from "../components/ui";
import { CARDS } from "../data/cards";
import { db, hasScope, type Student } from "../lib/db";
import { useT } from "../lib/i18n";

/** Where to send a returning student: the first step they haven't finished. */
export function nextStep(s: Student): Parameters<Go>[0] {
  if (!hasScope(s, "assess")) return { name: "consent", id: s.id };
  if (Object.keys(s.cards).length < CARDS.length) return { name: "cards", id: s.id };
  if (Object.keys(s.answers).length === 0) return { name: "questions", id: s.id };
  if (Object.keys(s.factAnswers).length === 0) return { name: "facts", id: s.id };
  return { name: "results", id: s.id };
}

export default function Home({ go }: { go: Go }) {
  const { t } = useT();
  const students = useLive(
    () => db.students.orderBy("updated_at").reverse().filter((s) => !s.simulated).toArray(),
    [],
    [] as Student[],
  );

  return (
    <Screen>
      <section className="rounded-3xl bg-brand p-5 text-white">
        <div className="flex items-start gap-3">
          <p className="flex-1 text-xl leading-relaxed font-semibold">{t("tagline")}</p>
          <SpeakButton text={t("tagline")} audioKey="welcome" />
        </div>
      </section>

      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-lg font-semibold">{t("whoIsUsing")}</h2>
        <SpeakButton text={t("whoIsUsing")} audioKey="who" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {students.map((s) => (
          <button
            key={s.id}
            onClick={() => go(nextStep(s))}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-3xl border-2 border-line bg-white p-2 active:border-brand"
          >
            <span className="text-5xl">{s.avatar}</span>
            <span className="w-full truncate text-center text-sm font-medium">{s.name}</span>
          </button>
        ))}
        <button
          onClick={() => go({ name: "new" })}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-brand bg-brand-soft p-2 text-brand-dark"
        >
          <span className="text-4xl">＋</span>
          <span className="text-center text-sm font-semibold">{t("newStudent")}</span>
        </button>
      </div>

      <div className="mt-auto pt-6">
        <Button kind="ghost" className="w-full" onClick={() => go({ name: "teacher" })}>
          🧑‍🏫 {t("teacher")}
        </Button>
        <Button kind="ghost" className="w-full text-base" onClick={() => go({ name: "funder" })}>
          📊 {t("funderView")}
        </Button>
      </div>
    </Screen>
  );
}
