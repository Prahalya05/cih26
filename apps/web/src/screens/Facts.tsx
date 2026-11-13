import type { Go } from "../App";
import { FactQuestionView } from "../components/FactQuestionView";
import { Button, Screen, SpeakButton, useLive } from "../components/ui";
import { FACT_QUESTIONS, FIRST_QUESTIONS } from "../data/facts";
import { db, patchStudent } from "../lib/db";
import { useT } from "../lib/i18n";

export default function FactsScreen({ go, id }: { go: Go; id: string }) {
  const { t } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  if (!student) return null;

  const set = (key: string, v: unknown) =>
    void patchStudent(id, (s) => {
      const factAnswers = { ...s.factAnswers };
      if (v === undefined) delete factAnswers[key];
      else factAnswers[key] = v;
      return { ...s, factAnswers };
    });

  const isSchool = /^\d+$/.test(String(student.factAnswers.level ?? ""));

  return (
    <Screen title={t("factsTitle")} onBack={() => go({ name: "questions", id })}>
      <div className="flex items-start gap-3">
        <p className="flex-1 text-muted">{t("factsHint")}</p>
        <SpeakButton text={t("factsHint")} audioKey="facts_hint" />
      </div>
      <div className="flex flex-col gap-6 rounded-3xl bg-white p-5 shadow-sm">
        {FIRST_QUESTIONS.map((key) => (
          <FactQuestionView key={key} q={FACT_QUESTIONS[key] ?? { key, en: key, ta: key }} value={student.factAnswers[key]} onChange={(v) => set(key, v)} />
        ))}
        {!isSchool && typeof student.factAnswers.level === "string" && student.factAnswers.level !== "out" && (
          <FactQuestionView q={FACT_QUESTIONS.year_of_study} value={student.factAnswers.year_of_study} onChange={(v) => set("year_of_study", v)} />
        )}
      </div>
      <Button className="mt-2" onClick={async () => {
        // Mark the step as done even if everything was skipped.
        await patchStudent(id, (s) => ({ ...s, factAnswers: { state: "TN", ...s.factAnswers } }));
        go({ name: "results", id });
      }}>{t("done")} →</Button>
    </Screen>
  );
}
