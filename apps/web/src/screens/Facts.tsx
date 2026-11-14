
import type { Go } from "../App";
import { FactQuestionView } from "../components/FactQuestionView";
import { Button, Screen, SpeakButton, useLive } from "../components/ui";
import { FACT_QUESTIONS, FIRST_QUESTIONS } from "../data/facts";
import { db, patchStudent } from "../lib/db";
import { useT } from "../lib/i18n";

export default function FactsScreen({ go, id }: { go: Go; id: string }) {
  const { t } = useT();

  const student = useLive(
    () => db.students.get(id),
    [id],
    undefined
  );

  if (!student) return null;

  const set = (key: string, v: unknown) =>
    void patchStudent(id, (s) => {
      const factAnswers = { ...s.factAnswers };

      if (v === undefined) delete factAnswers[key];
      else factAnswers[key] = v;

      return { ...s, factAnswers };
    });

  const isSchool = /^\d+$/.test(
    String(student.factAnswers.level ?? "")
  );

  return (
    <Screen
      title={t("factsTitle")}
      onBack={() => go({ name: "questions", id })}
    >
      {/* Introduction */}
      <div className="relative overflow-hidden rounded-[2rem] border border-[#E9DDF4] bg-gradient-to-br from-[#F1EAF9] to-[#FFF0F5] p-5">
        <div className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-white/50" />

        <div className="relative flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
            🎓
          </div>

          <div className="flex-1">
            <h2 className="text-lg font-bold text-[#554365]">
              {t("factsTitle")}
            </h2>

            <p className="mt-2 text-sm leading-relaxed text-[#796B86]">
              {t("factsHint")}
            </p>
          </div>

          <SpeakButton
            text={t("factsHint")}
            audioKey="facts_hint"
          />
        </div>
      </div>

      {/* Student information form */}
      <div className="rounded-[2rem] border border-[#EDE3F6] bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#F2EAF9] text-xl">
            📝
          </div>

          <div>
            <h3 className="font-bold text-[#554365]">
              Student Information
            </h3>

            <p className="text-xs text-[#9686A5]">
              Fill in the details below
            </p>
          </div>
        </div>

        <div className="mb-5 h-px bg-[#F0EAF5]" />

        <div className="flex flex-col gap-7">
          {FIRST_QUESTIONS.map((key, index) => (
            <div
              key={key}
              className="rounded-2xl border border-[#F0EAF5] bg-[#FCFAFE] p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#EDE3F7] text-xs font-bold text-[#765795]">
                  {index + 1}
                </span>
              </div>

              <FactQuestionView
                q={
                  FACT_QUESTIONS[key] ?? {
                    key,
                    en: key,
                    ta: key,
                  }
                }
                value={student.factAnswers[key]}
                onChange={(v) => set(key, v)}
              />
            </div>
          ))}

          {!isSchool &&
            typeof student.factAnswers.level === "string" &&
            student.factAnswers.level !== "out" && (
              <div className="rounded-2xl border border-[#F0EAF5] bg-[#FCFAFE] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-[#FCEAF1] text-xs font-bold text-[#A65373]">
                    ✨
                  </span>

                  <span className="text-sm font-semibold text-[#765795]">
                    Additional Information
                  </span>
                </div>

                <FactQuestionView
                  q={FACT_QUESTIONS.year_of_study}
                  value={student.factAnswers.year_of_study}
                  onChange={(v) => set("year_of_study", v)}
                />
              </div>
            )}
        </div>
      </div>

      {/* Completion button */}
      <Button
        className="mt-2"
        onClick={async () => {
          // Mark the step as done even if everything was skipped.
          await patchStudent(id, (s) => ({
            ...s,
            factAnswers: {
              state: "TN",
              ...s.factAnswers,
            },
          }));

          go({ name: "results", id });
        }}
      >
        {t("done")} →
      </Button>
    </Screen>
  );
}
