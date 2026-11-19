// "Show your work": take a photo of something she made, or film her doing the task, scored against a checklist.
// Videos: faces are blurred and hands tracked on the phone (lib/video.ts); the AI gives a time for each step.

import { useEffect, useRef, useState } from "react";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive } from "../components/ui";
import { db, hasScope, patchStudent, scopesOf } from "../lib/db";
import { useT } from "../lib/i18n";
import { compressImage, rubricFor, saveSample, saveVideoSample, scoreSample, type ScoreResult } from "../lib/samples";
import { MAX_SECONDS, startFilming, type Filming, type Process } from "../lib/video";

type Stage = "ready" | "camera" | "filming" | "saving" | "scoring" | "scored" | "waiting";

export default function WorkSample({ go, id, rubric: rubricId }: { go: Go; id: string; rubric: string }) {
  const { t, pick } = useT();
  const student = useLive(() => db.students.get(id), [id], undefined);
  const rubric = student ? rubricFor(student, rubricId) : null;
  const [stage, setStage] = useState<Stage>("ready");
  const [preview, setPreview] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [process, setProcess] = useState<Process | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const filming = useRef<Filming | null>(null);

  useEffect(() => () => filming.current?.close(), []);
  if (!student || !rubric) return null;
  const back = () => { filming.current?.close(); go({ name: "results", id, tab: "strengths" }); };

  const score = async (eventId: string | null) => {
    const pending = eventId ? await db.events.get(eventId) : undefined;
    if (!pending) { setStage("ready"); return; }
    setStage("scoring");
    const out = await scoreSample(pending);
    setResult(out);
    setStage(out ? "scored" : "waiting");
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setStage("saving");
    const photo = await compressImage(file);
    setPreview(URL.createObjectURL(photo));
    await score(await saveSample(id, rubric, photo));
  };

  const openCamera = async () => {
    setCameraError(false);
    setStage("camera");
    try {
      // wait a frame so the canvas is on the page
      await new Promise((r) => requestAnimationFrame(r));
      filming.current = await startFilming(canvas.current!);
    } catch {
      setCameraError(true);
      setStage("ready");
    }
  };

  const film = async () => {
    const f = filming.current;
    if (!f) return;
    setStage("filming");
    setSeconds(0);
    try {
      const clip = await f.record(setSeconds);
      f.close();
      filming.current = null;
      setProcess(clip.process);
      setVideoUrl(URL.createObjectURL(clip.blob));
      setStage("saving");
      await score(await saveVideoSample(id, rubric, clip.blob, clip.process));
    } catch {
      setCameraError(true);
      setStage("ready");
    }
  };

  const jump = (mmss: string) => {
    const [m, s] = mmss.split(":").map(Number);
    if (player.current) { player.current.currentTime = m * 60 + s; void player.current.play(); }
  };

  const photosAllowed = hasScope(student, "photos");
  const showCamera = stage === "camera" || stage === "filming";
  return (
    <Screen title={pick(rubric.name)} onBack={back}>
      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <p className="text-lg">📷 {pick(rubric.capture)}</p>
        <p className="mt-3 text-sm font-semibold text-muted">{t("checklist")}</p>
        <ul className="mt-1 flex flex-col gap-1">
          {rubric.criteria.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="flex-1">{pick(c.name)}</span>
              {result?.times?.[c.id] && videoUrl && (
                <button className="rounded-lg bg-brand-soft px-2 py-1 font-mono text-sm text-brand" onClick={() => jump(result.times![c.id])}>
                  ▶ {result.times[c.id]}
                </button>
              )}
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
            onClick={() => patchStudent(id, (s) => ({ ...s, consent: { ...s.consent!, scopes: [...scopesOf(s), "photos"], photos: undefined } }))}>
            ✅ {t("photoConsentAgree")}
          </Button>
        </div>
      )}

      {showCamera && (
        <div className="relative overflow-hidden rounded-3xl bg-black">
          <canvas ref={canvas} className="w-full" />
          {stage === "filming" && (
            <span className="absolute left-3 top-3 rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white">
              ● {Math.floor(seconds)} / {MAX_SECONDS} s
            </span>
          )}
          <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">🙈 {t("faceBlurOn")}</span>
        </div>
      )}
      {stage === "camera" && <Button onClick={() => void film()}>⏺ {t("startFilming")}</Button>}
      {stage === "filming" && <Button kind="soft" onClick={() => filming.current?.stop()}>⏹ {t("stopFilming")}</Button>}

      {preview && <img src={preview} alt="" className="max-h-72 w-full rounded-3xl object-contain" />}
      {videoUrl && <video ref={player} src={videoUrl} controls playsInline className="max-h-72 w-full rounded-3xl bg-black" />}
      {process && (
        <p className="text-sm text-muted">
          ✋ {t("handsSeen", { pct: Math.round(process.hands_visible * 100) })} · {t("steadiness", { pct: Math.round(process.steadiness * 100) })}
        </p>
      )}
      {result?.safety && result.safety.length > 0 && (
        <ul className="rounded-2xl bg-sun-soft p-3 text-warn">
          {result.safety.map((s, i) => <li key={i}>⚠ {s.time} — {s.note}</li>)}
        </ul>
      )}

      {stage === "ready" && (
        <div className="flex flex-col gap-3">
          <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-lg font-semibold text-white">
            📷 {t("takePhoto")}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          <Button kind="soft" disabled={!photosAllowed} onClick={() => void openCamera()}>🎥 {t("filmTask")}</Button>
          {cameraError && <p className="rounded-2xl bg-sun-soft p-3 text-warn">{t("cameraUnavailable")}</p>}
        </div>
      )}
      {(stage === "saving" || stage === "scoring") && <p className="text-center font-medium text-muted">{t("thinking")}</p>}
      {stage === "scored" && result && result.cannot_see.length > 0 && <p className="rounded-2xl bg-sun-soft p-3 text-warn">{t("retakeHint")}</p>}
      {stage === "scored" && <p className="rounded-2xl bg-good-soft p-3 text-good">{t("sampleScored")}</p>}
      {stage === "waiting" && <p className="rounded-2xl bg-sun-soft p-3 text-warn">{t("sampleSaved")}</p>}
      {(stage === "scored" || stage === "waiting") && <Button onClick={back}>{t("done")}</Button>}
    </Screen>
  );
}
