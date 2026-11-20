// Onboarding step 2: what she is doing now, and how comfortable she is reading.
// A fixed rule (engine uiModeOf) turns age + reading into the kind of screens she starts with. She can change it later.

import { ageFromBirthYear, NOT_IN_SCHOOL, uiModeOf, type Literacy, type Scenario } from "@disha/engine";
import { useEffect, useState } from "react";
import type { Go } from "../App";
import { Icon } from "../components/Icon";
import { Button, Screen, SpeakButton, useLive } from "../components/ui";
import { db, patchStudent } from "../lib/db";
import { useT, type StringKey } from "../lib/i18n";
import { speak } from "../lib/speech";
import { emit } from "../lib/xray";

const SCENARIOS: { v: Scenario; emoji: string; key: StringKey }[] = [
  { v: "school", emoji: "🏫", key: "sit_school" },
  { v: "college", emoji: "🎓", key: "sit_college" },
  { v: "stopped", emoji: "🏠", key: "sit_stopped" },
  { v: "seeking", emoji: "🔎", key: "sit_seeking" },
  { v: "working", emoji: "💼", key: "sit_working" },
];
const COURSES: { v: string; emoji: string; en: string; ta: string; hi: string }[] = [
  { v: "iti", emoji: "🔧", en: "ITI", ta: "ஐடிஐ", hi: "आईटीआई" },
  { v: "diploma", emoji: "📐", en: "Diploma", ta: "பட்டயம்", hi: "डिप्लोमा" },
  { v: "ug", emoji: "🎓", en: "Degree", ta: "பட்டம்", hi: "डिग्री" },
];
const READING: { v: Literacy; emoji: string; key: StringKey }[] = [
  { v: "easy", emoji: "📖", key: "read_easy" },
  { v: "little", emoji: "🙂", key: "read_little" },
  { v: "helped", emoji: "🤝", key: "read_helped" },
];

export default function Situation({ go, id }: { go: Go; id: string }) {
  const { t, pick, lang } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const [scenario, setScenario] = useState<Scenario | undefined>();
  const [cls, setCls] = useState<number | undefined>();
  const [course, setCourse] = useState<string | undefined>();
  const [literacy, setLiteracy] = useState<Literacy | undefined>();

  useEffect(() => { speak(t("whatDoing"), lang, "what_doing"); }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!student) return;
    setScenario((v) => v ?? student.scenario);
    setCls((v) => v ?? student.current_class);
    setLiteracy((v) => v ?? student.literacy);
  }, [student]);
  if (!student) return null;

  const age = ageFromBirthYear(student.birth_year);
  const needsSub = scenario === "school" ? cls !== undefined : scenario === "college" ? course !== undefined : true;
  const ready = !!scenario && needsSub && !!literacy;
  const preview = ready ? uiModeOf({ age, literacy }) : null;

  const save = async () => {
    if (!scenario || !literacy) return;
    const { mode, why } = uiModeOf({ age, literacy });
    const level = scenario === "school" ? (cls ? String(cls) : undefined) : scenario === "college" ? course : NOT_IN_SCHOOL.includes(scenario) ? "out" : undefined;
    await patchStudent(id, (s) => ({
      ...s, scenario, literacy, uiMode: mode, current_class: scenario === "school" ? cls : undefined,
      factAnswers: level ? { ...s.factAnswers, level } : s.factAnswers,
    }));
    emit({
      step: "onboarding", source: "RULE", ref: "rule.uimode", title: `Screen mode: ${mode.replace("_", "/")}`, subject: `uimode:${id}`,
      inputs: { age: age ?? "not given", situation: scenario, reads: literacy }, output: t(`mode_${mode}` as StringKey), why,
    });
    go({ name: "consent", id });
  };

  const Option = ({ on, onClick, emoji, label }: { on: boolean; onClick: () => void; emoji: string; label: string }) => (
    <button onClick={onClick} aria-pressed={on}
      className={`flex min-h-16 items-center gap-3 rounded-2xl border px-3 py-2 text-left text-base font-semibold transition ${on ? "border-brand bg-brand text-white" : "border-line bg-surface hover:border-faint"}`}>
      <span className="text-3xl">{emoji}</span><span className="flex-1">{label}</span>
      {on && <Icon name="check" className="size-5" />}
    </button>
  );

  return (
    <Screen title={t("situationTitle")} onBack={() => go({ name: "home" })}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-xl font-extrabold">{t("whatDoing")}</h2>
        <SpeakButton text={t("whatDoing")} audioKey="what_doing" />
      </div>
      <div className="flex flex-col gap-2">
        {SCENARIOS.map((x) => <Option key={x.v} on={scenario === x.v} onClick={() => setScenario(x.v)} emoji={x.emoji} label={t(x.key)} />)}
      </div>

      {scenario === "school" && (
        <>
          <h3 className="font-bold">{t("whichClass")}</h3>
          <div className="grid grid-cols-5 gap-2">
            {[8, 9, 10, 11, 12].map((n) => (
              <button key={n} onClick={() => setCls(n)} aria-pressed={cls === n}
                className={`min-h-14 rounded-xl border text-xl font-bold ${cls === n ? "border-brand bg-brand text-white" : "border-line bg-surface"}`}>{n}</button>
            ))}
          </div>
        </>
      )}
      {scenario === "college" && (
        <>
          <h3 className="font-bold">{t("whichCourse")}</h3>
          <div className="grid grid-cols-3 gap-2">
            {COURSES.map((c) => (
              <button key={c.v} onClick={() => setCourse(c.v)} aria-pressed={course === c.v}
                className={`flex min-h-16 flex-col items-center justify-center rounded-xl border font-bold ${course === c.v ? "border-brand bg-brand text-white" : "border-line bg-surface"}`}>
                <span className="text-2xl">{c.emoji}</span>{pick(c)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-2 flex items-center gap-2">
        <h2 className="flex-1 text-xl font-extrabold">{t("canYouRead")}</h2>
        <SpeakButton text={t("canYouRead")} audioKey="can_you_read" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {READING.map((x) => (
          <button key={x.v} onClick={() => setLiteracy(x.v)} aria-pressed={literacy === x.v}
            className={`flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-center text-sm font-bold ${literacy === x.v ? "border-brand bg-brand text-white" : "border-line bg-surface"}`}>
            <span className="text-4xl">{x.emoji}</span>{t(x.key)}
          </button>
        ))}
      </div>

      {preview && (
        <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-accent-dark">{t("modeChosen", { mode: t(`mode_${preview.mode}` as StringKey) })}</p>
      )}
      <Button className="mt-auto" disabled={!ready} onClick={save}>{t("next")} <Icon name="next" className="size-5" /></Button>
    </Screen>
  );
}
