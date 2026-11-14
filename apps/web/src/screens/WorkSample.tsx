// "Show your work": take a photo of something she made; it is scored against a checklist.

import { useState } from "react";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive } from "../components/ui";
import { db, patchStudent } from "../lib/db";
import { useT } from "../lib/i18n";
import { compressImage, saveSample, scoreSample, type RubricFull, type ScoreResult } from "../lib/samples";
import { RUBRICS } from "../lib/skills";

type Stage = "ready" | "saving" | "scoring" | "scored" | "waiting";

export default function WorkSample({ go, id, rubric: rubricId }: { go: Go; id: string; rubric: string }) {
  const { t, pick } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const rubric = RUBRICS[rubricId] as unknown as RubricFull | undefined;
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
    if (!pending) { setStage("ready"); return; }
    setStage("scoring");
    const out = await scoreSample(pending);
    setResult(out);
    setStage(out ? "scored" : "waiting");
  };

  const photosAllowed = !!student.consent?.photos;
  return (
    <Screen title={pick(rubric.name)} onBack={back}>
      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <p className="text-lg">📷 {pick(rubric.capture)}</p>
        <p className="mt-3 text-sm font-semibold text-muted">{t("checklist")}</p>
        <ul className="mt-1 flex flex-col gap-1">
          {rubric.criteria.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="flex-1">{pick(c.name)}</span>
              {result && (c.id in result.scores
                ? <Pill tone={result.scores[c.id] === 2 ? "good" : result.scores[c.id] === 1 ? "sun" : "neutral"}>{"★".repeat(result.scores[c.id]) || "–"}</Pill>
                : <Pill>{t("cannotSee")}</Pill>)}
            </li>
          ))}
        </ul>
      </div>

      {!photosAllowed && (
        <div className="rounded-3xl bg-sun-soft p-4">
          <p className="text-warn">{t("photoConsent")}</p>
          <Button kind="soft" className="mt-3 w-full"
            onClick={() => patchStudent(id, (s) => ({ ...s, consent: { at: s.consent?.at ?? Date.now(), photos: true } }))}>
            ✅ {t("photoConsentAgree")}
          </Button>
        </div>
      )}

      {preview && <img src={preview} alt="" className="max-h-72 w-full rounded-3xl object-contain" />}

      {stage === "ready" && (
        <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-lg font-semibold text-white">
          📷 {t("takePhoto")}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
        </label>
      )}
      {(stage === "saving" || stage === "scoring") && <p className="text-center font-medium text-muted">{t("thinking")}</p>}
      {stage === "scored" && result && result.cannot_see.length > 0 && <p className="rounded-2xl bg-sun-soft p-3 text-warn">{t("retakeHint")}</p>}
      {stage === "scored" && <p className="rounded-2xl bg-good-soft p-3 text-good">{t("sampleScored")}</p>}
      {stage === "waiting" && <p className="rounded-2xl bg-sun-soft p-3 text-warn">{t("sampleSaved")}</p>}
      {(stage === "scored" || stage === "waiting") && <Button onClick={back}>{t("done")}</Button>}
    </Screen>
  );
}
