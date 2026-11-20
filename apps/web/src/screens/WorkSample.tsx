// "Show your work": take a photo of something she made, or film her doing the task, scored against a checklist.
// Videos: faces are blurred and hands tracked on the phone (lib/video.ts); the AI gives a time for each step.

import { useEffect, useRef, useState } from "react";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive } from "../components/ui";
import { db, hasScope, patchStudent, scopesOf } from "../lib/db";
import { useT } from "../lib/i18n";
import { compressImage, rubricFor, saveSample, saveVideoSample, scoreSample, type ScoreResult } from "../lib/samples";
import { MAX_SECONDS, startFilming, type Filming, type Process } from "../lib/video";
import { Icon } from "../components/Icon";

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
      <div className="rounded-2xl bg-surface p-4 border border-line">
        <p className="flex gap-3 text-lg font-medium"><Icon name="camera" className="mt-1 size-5 text-accent-dark" />{pick(rubric.capture)}</p>
        <p className="mt-3 text-sm font-semibold text-muted">{t("checklist")}</p>
        <ul className="mt-1 flex flex-col gap-1">
          {rubric.criteria.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="flex-1">{pick(c.name)}</span>
              {result?.times?.[c.id] && videoUrl && (
                <button className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-1 font-mono text-sm text-accent-dark" onClick={() => jump(result.times![c.id])}>
                  <Icon name="play" className="size-3" />{result.times[c.id]}
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
        <div className="rounded-2xl bg-sun-soft p-4">
          <p className="text-warn">{t("photoConsent")}</p>
          <Button kind="soft" className="mt-3 w-full"
            onClick={() => patchStudent(id, (s) => ({ ...s, consent: { ...s.consent!, scopes: [...scopesOf(s), "photos"], photos: undefined } }))}>
            <Icon name="check" className="size-5" />{t("photoConsentAgree")}
          </Button>
        </div>
      )}

      {showCamera && (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <canvas ref={canvas} className="w-full" />
          {stage === "filming" && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-md bg-bad px-2.5 py-1 font-mono text-sm font-bold text-white">
              <span className="size-2 animate-pulse rounded-full bg-surface" />{Math.floor(seconds)} / {MAX_SECONDS} s
            </span>
          )}
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-md bg-brand-dark/75 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"><Icon name="eyeOff" className="size-3.5" />{t("faceBlurOn")}</span>
        </div>
      )}
      {stage === "camera" && <Button onClick={() => void film()}><span className="size-3 rounded-full bg-bad" />{t("startFilming")}</Button>}
      {stage === "filming" && <Button kind="soft" onClick={() => filming.current?.stop()}><Icon name="stop" className="size-5" />{t("stopFilming")}</Button>}

      {preview && <img src={preview} alt="" className="max-h-72 w-full rounded-2xl object-contain" />}
      {videoUrl && <video ref={player} src={videoUrl} controls playsInline className="max-h-72 w-full rounded-2xl bg-black" />}
      {process && (
        <p className="text-sm text-muted">
          {t("handsSeen", { pct: Math.round(process.hands_visible * 100) })} · {t("steadiness", { pct: Math.round(process.steadiness * 100) })}
        </p>
      )}
      {result?.safety && result.safety.length > 0 && (
        <ul className="rounded-xl bg-sun-soft p-3 text-warn">
          {result.safety.map((s, i) => <li key={i} className="flex gap-2"><Icon name="alert" className="mt-0.5 size-4" /><span><span className="font-mono">{s.time}</span> {s.note}</span></li>)}
        </ul>
      )}

      {stage === "ready" && (
        <div className="flex flex-col gap-3">
          <label className="flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 text-base font-bold text-white">
            <Icon name="camera" className="size-5" />{t("takePhoto")}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          <Button kind="soft" disabled={!photosAllowed} onClick={() => void openCamera()}><Icon name="video" className="size-5" />{t("filmTask")}</Button>
          {cameraError && <p className="rounded-xl bg-sun-soft p-3 text-warn">{t("cameraUnavailable")}</p>}
        </div>
      )}
      {(stage === "saving" || stage === "scoring") && <p className="text-center font-medium text-muted">{t("thinking")}</p>}
      {stage === "scored" && result && result.cannot_see.length > 0 && <p className="rounded-xl bg-sun-soft p-3 text-warn">{t("retakeHint")}</p>}
      {stage === "scored" && <p className="rounded-xl bg-good-soft p-3 text-good">{t("sampleScored")}</p>}
      {stage === "waiting" && <p className="rounded-xl bg-sun-soft p-3 text-warn">{t("sampleSaved")}</p>}
      {(stage === "scored" || stage === "waiting") && <Button onClick={back}>{t("done")}</Button>}
    </Screen>
  );
}
