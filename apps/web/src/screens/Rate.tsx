
import { useState } from "react";
import { needsOf } from "@disha/engine";
import type { Go } from "../App";
import { Button, Screen, useLive } from "../components/ui";
import { db } from "../lib/db";
import { raterId, recordEvent } from "../lib/events";
import { useT } from "../lib/i18n";
import { kb } from "../lib/kb";

export const TERM_SKILLS = [
  "sk_communication",
  "sk_leadership",
  "sk_basic_math",
  "sk_computer_basic",
  "sk_organising",
];

export default function Rate({
  go,
  id,
  mode,
}: {
  go: Go;
  id: string;
  mode: "taster" | "term";
}) {
  const { t, pick } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const [occ, setOcc] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState(false);

  const g = kb.graph!;
  if (!student) return null;

  const back = () => go({ name: "teacher" });

  const units =
    mode === "term"
      ? TERM_SKILLS
      : occ
        ? needsOf(g, occ).map((n) => n.id)
        : [];

  const name = (u: string) =>
    pick(g.subskills[u]?.name ?? kb.skills[u]?.name ?? { en: u });

  const describe = (u: string, L: number) => {
    const d = g.subskills[u]?.levels[String(L) as "1"];
    return d
      ? pick({ en: d.en, ta: d.ta ?? undefined })
      : t(`level${L}` as "level1");
  };

  const save = async () => {
    const rater = await raterId();

    if (mode === "taster") {
      await recordEvent({
        student_id: id,
        kind: "taster",
        rater_id: rater,
        payload: { levels, occupation: occ },
      });
    } else {
      for (const [u, L] of Object.entries(levels)) {
        await recordEvent({
          student_id: id,
          kind: "rating",
          rater_id: rater,
          ...(g.subskills[u] ? { subskill_id: u } : { skill_id: u }),
          payload: { level: L, term: true },
        });
      }
    }

    setSaved(true);
  };

  return (
    <Screen title={`${student.avatar} ${student.name}`} onBack={back}>
      <div className="flex flex-col gap-5">

        {/* Heading */}
        <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-2xl">
              {mode === "taster" ? "🌟" : "📋"}
            </span>
            <h2 className="text-xl font-bold">
              {mode === "taster" ? t("rateTaster") : t("rateTerm")}
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">
            {mode === "taster" ? t("rateTasterHint") : t("rateTermHint")}
          </p>
        </div>

        {/* Career selection */}
        {mode === "taster" && !occ && (
          <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-2">
              {Object.values(kb.occupations).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOcc(o.id)}
                  className="flex items-center justify-between rounded-2xl border border-line bg-paper p-4 text-left font-medium hover:border-brand hover:bg-brand-soft"
                >
                  {pick(o.name)}
                  <span className="text-brand-dark">›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selected career */}
        {mode === "taster" && occ && (
          <div className="flex items-center justify-between rounded-2xl bg-brand-soft p-4">
            <span className="font-semibold">
              {pick(kb.occupations[occ]?.name ?? { en: occ })}
            </span>
            <button
              type="button"
              onClick={() => {
                setOcc(null);
                setLevels({});
              }}
              className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-brand-dark"
            >
              Change
            </button>
          </div>
        )}

        {/* Skill rating cards */}
        {units.map((u, index) => (
          <div
            key={u}
            className="rounded-3xl border border-line bg-white p-4 shadow-sm"
          >
            <div className="mb-3 flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-sm font-bold text-brand-dark">
                {index + 1}
              </span>
              <p className="flex-1 font-semibold">{name(u)}</p>
            </div>

            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4].map((L) => (
                <button
                  key={L}
                  type="button"
                  onClick={() => setLevels({ ...levels, [u]: L })}
                  aria-pressed={levels[u] === L}
                  className={`flex items-start gap-3 rounded-2xl border-2 p-3 text-left text-sm ${
                    levels[u] === L
                      ? "border-brand bg-brand-soft"
                      : "border-line bg-paper"
                  }`}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-xl font-bold ${
                      levels[u] === L
                        ? "bg-brand text-white"
                        : "bg-white text-muted"
                    }`}
                  >
                    {L}
                  </span>
                  <span className="flex-1 pt-1 leading-5">
                    {describe(u, L)}
                  </span>
                  {levels[u] === L && (
                    <span className="pt-1 font-bold text-brand-dark">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Save button */}
        {units.length > 0 && !saved && (
          <div className="rounded-3xl border border-line bg-white p-4 shadow-sm">
            <div className="mb-3 flex justify-between text-sm">
              <span className="font-semibold">Ratings completed</span>
              <span className="font-bold text-brand-dark">
                {Object.keys(levels).length} / {units.length}
              </span>
            </div>

            <div className="mb-4 h-2 overflow-hidden rounded-full bg-brand-soft">
              <div
                className="h-full rounded-full bg-brand"
                style={{
                  width: `${(Object.keys(levels).length / units.length) * 100}%`,
                }}
              />
            </div>

            <div className="w-full [&>button]:w-full">
  <Button
    disabled={Object.keys(levels).length === 0}
    onClick={() => void save()}
  >
    ✔ {t("saveRatings")}
  </Button>
</div>
          </div>
        )}

        {/* Success message */}
        {saved && (
          <div className="rounded-3xl border border-good/20 bg-good-soft p-5 text-center">
            <div className="mb-3 text-4xl">🎉</div>
            <p className="font-bold text-good">{t("ratingsSaved")}</p>
            <div className="mt-4">
              <div className="w-full">
  <Button onClick={back}>
    {t("done")}
  </Button>
</div>
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
