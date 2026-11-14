
import { useState } from "react";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive } from "../components/ui";
import { db, hasScope, patchStudent, scopesOf } from "../lib/db";
import { useT } from "../lib/i18n";
import {
  compressImage,
  rubricFor,
  saveSample,
  scoreSample,
  type ScoreResult,
} from "../lib/samples";

type Stage = "ready" | "saving" | "scoring" | "scored" | "waiting";

export default function WorkSample({
  go,
  id,
  rubric: rubricId,
}: {
  go: Go;
  id: string;
  rubric: string;
}) {
  const { t, pick } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const rubric = student ? rubricFor(student, rubricId) : null;

  const [stage, setStage] = useState<Stage>("ready");
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);

  if (!student || !rubric) return null;

  const back = () => go({ name: "results", id, tab: "strengths" });

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;

    setStage("saving");

    const photo = await compressImage(file);
    setPreview(URL.createObjectURL(photo));

    const eventId = await saveSample(id, rubric, photo);
    const pending = eventId ? await db.events.get(eventId) : undefined;

    if (!pending) {
      setStage("ready");
      return;
    }

    setStage("scoring");

    const out = await scoreSample(pending);
    setResult(out);
    setStage(out ? "scored" : "waiting");
  };

  const photosAllowed = hasScope(student, "photos");

  return (
    <Screen title={pick(rubric.name)} onBack={back}>
      <div className="flex flex-col gap-5 pb-4">

        {/* Introduction */}
        <section className="rounded-3xl border border-line bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-2xl">
              📸
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{pick(rubric.name)}</p>
            </div>
          </div>

          <p className="text-sm leading-6 text-muted">
            {pick(rubric.capture)}
          </p>
        </section>

        {/* Checklist */}
        <section className="rounded-3xl border border-line bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-xl">
              📋
            </div>
            <h3 className="text-lg font-bold">{t("checklist")}</h3>
          </div>

          <div className="flex flex-col gap-3">
            {rubric.criteria.map((c, index) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-2xl bg-paper p-3"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-bold text-brand-dark">
                  {index + 1}
                </span>

                <span className="min-w-0 flex-1 text-sm font-medium leading-5">
                  {pick(c.name)}
                </span>

                {result && (
                  c.id in result.scores ? (
                    <Pill
                      tone={
                        result.scores[c.id] === 2
                          ? "good"
                          : result.scores[c.id] === 1
                            ? "sun"
                            : "neutral"
                      }
                    >
                      {"★".repeat(result.scores[c.id]) || "–"}
                    </Pill>
                  ) : (
                    <Pill>{t("cannotSee")}</Pill>
                  )
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Photo consent */}
        {!photosAllowed && (
          <section className="rounded-3xl border border-line bg-sun-soft p-5">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔒</span>
              <p className="font-semibold text-warn">
                {t("photoConsent")}
              </p>
            </div>

            <div className="mt-4">
              <Button
                kind="soft"
                className="w-full"
                onClick={() =>
                  patchStudent(id, (s) => ({
                    ...s,
                    consent: {
                      ...s.consent!,
                      scopes: [...scopesOf(s), "photos"],
                      photos: undefined,
                    },
                  }))
                }
              >
                ✅ {t("photoConsentAgree")}
              </Button>
            </div>
          </section>
        )}

        {/* Photo preview */}
        {preview && (
          <section className="rounded-3xl border border-line bg-white p-4 shadow-sm">
            <p className="mb-3 font-bold">📷</p>
            <img
              src={preview}
              alt=""
              className="max-h-80 w-full rounded-2xl bg-paper object-contain"
            />
          </section>
        )}

        {/* Camera capture */}
        {stage === "ready" && (
          <label className="flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-2xl bg-brand px-5 py-4 text-center text-lg font-bold text-white shadow-sm transition-opacity hover:opacity-90">
            <span className="text-2xl">📸</span>
            {t("takePhoto")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void onPhoto(e.target.files?.[0])}
            />
          </label>
        )}

        {/* Processing */}
        {(stage === "saving" || stage === "scoring") && (
          <section className="rounded-3xl border border-line bg-white p-5 text-center shadow-sm">
            <div className="mb-3 text-3xl">✨</div>
            <p className="font-semibold text-muted">{t("thinking")}</p>
          </section>
        )}

        {/* Scoring feedback */}
        {stage === "scored" && result && result.cannot_see.length > 0 && (
          <div className="rounded-2xl border border-line bg-sun-soft p-4">
            <p className="text-sm leading-6 text-warn">
              {t("retakeHint")}
            </p>
          </div>
        )}

        {stage === "scored" && (
          <div className="rounded-3xl border border-good/20 bg-good-soft p-5 text-center">
            <div className="mb-2 text-3xl">🎉</div>
            <p className="font-bold text-good">{t("sampleScored")}</p>
          </div>
        )}

        {stage === "waiting" && (
          <div className="rounded-3xl border border-line bg-sun-soft p-5 text-center">
            <div className="mb-2 text-3xl">⏳</div>
            <p className="font-semibold text-warn">{t("sampleSaved")}</p>
          </div>
        )}

        {/* Done */}
        {(stage === "scored" || stage === "waiting") && (
          <Button onClick={back}>
            {t("done")}
          </Button>
        )}
      </div>
    </Screen>
  );
}
