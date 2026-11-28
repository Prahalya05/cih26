// "Show your work": take a photo of something she made, or film her doing the task, scored against a checklist.
// Videos: faces are blurred and hands tracked on the phone (lib/video.ts); the AI gives a time for each step.

import { useEffect, useRef, useState } from "react";
import type { Go } from "../App";
import { Button, Pill, Screen, useLive } from "../components/ui";
import { db, hasScope, patchStudent, scopesOf } from "../lib/db";
import { useT } from "../lib/i18n";
import { compressImage, rubricFor, saveSample, saveVideoSample, scoreSample, type ScoreResult } from "../lib/samples";
import { MAX_SECONDS, startFilming, startFromFile, type Filming, type LiveStatus, type Process, type VideoFlag } from "../lib/video";
import type { IdentityInput } from "@disha/engine";
import { IdentityGate } from "../components/IdentityGate";
import { VideoRules } from "../components/VideoRules";
import { emit } from "../lib/xray";
import { Icon } from "../components/Icon";

type Stage = "ready" | "rules" | "identity" | "camera" | "filming" | "blurring" | "saving" | "scoring" | "scored" | "waiting";

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
  const [uploadError, setUploadError] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [warnings, setWarnings] = useState<VideoFlag[]>([]);
  // what the instruction page leads to: filming live, or choosing a video from the gallery
  const [rulesNext, setRulesNext] = useState<"film" | "upload">("film");
  const showRules = (next: "film" | "upload") => { setCameraError(false); setUploadError(false); setRulesNext(next); setStage("rules"); };
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const filming = useRef<Filming | null>(null);
  const identity = useRef<IdentityInput | null>(null);

  useEffect(() => () => filming.current?.close(), []);
  // Live hints: read what the phone sees a few times a second while the camera is open.
  const cameraOpen = stage === "camera" || stage === "filming";
  useEffect(() => {
    if (!cameraOpen) { setLive(null); return; }
    const timer = window.setInterval(() => setLive(filming.current?.live() ?? null), 300);
    return () => window.clearInterval(timer);
  }, [cameraOpen]);
  if (!student || !rubric) return null;
  const back = () => { filming.current?.close(); go({ name: "results", id, tab: "strengths" }); };

  const score = async (eventId: string | null) => {
    const pending = eventId ? await db.events.get(eventId) : undefined;
    if (!pending) { setStage("ready"); return; }
    setStage("scoring");
    const out = await scoreSample(pending);
    setResult(out);
    if (out?.identity) emit({ step: "skills", source: "RULE", ref: "rule.identity", title: `Is it her? ${out.identity.status}`, subject: `sample:${pending.id}`, output: out.identity.status, why: out.identity.why });
    if (out?.autoconfirm) emit({ step: "skills", source: "RULE", ref: "rule.autoconfirm", title: out.autoconfirm.decision === "auto_confirm" ? "System confirmed the AI's score" : "Sent to the teacher", subject: `sample:${pending.id}`, output: out.autoconfirm.decision, why: [...out.autoconfirm.why, ...(out.autoconfirm.kappa_basis ? [`κ basis: ${out.autoconfirm.kappa_basis}`] : [])] });
    setStage(out ? "scored" : "waiting");
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setStage("saving");
    const photo = await compressImage(file);
    setPreview(URL.createObjectURL(photo));
    await score(await saveSample(id, rubric, photo));
  };

  // First a quick "is it you?" check on the front camera (rule.identity), then the back camera films the task.
  const openCamera = () => { setCameraError(false); setStage("identity"); };
  const openTaskCamera = async (id_: IdentityInput | null) => {
    identity.current = id_;
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
    await recordAndSave(f, () => setCameraError(true));
  };

  // A video from the gallery: played once through the face blur on this phone, and only the blurred copy is kept.
  // There is no live "is it you?" check for it, and a teacher always checks it (flag "uploaded").
  const onVideoFile = async (file: File | undefined) => {
    if (!file) return;
    setCameraError(false);
    setUploadError(false);
    identity.current = null;
    setStage("blurring");
    setSeconds(0);
    let f: Filming;
    try {
      await new Promise((r) => requestAnimationFrame(r)); // the canvas must be on the page
      f = await startFromFile(canvas.current!, file);
    } catch {
      setUploadError(true);
      setStage("ready");
      return;
    }
    filming.current = f;
    await recordAndSave(f, () => setUploadError(true));
  };

  const recordAndSave = async (f: Filming, onFail: () => void) => {
    try {
      const clip = await f.record(setSeconds);
      f.close();
      filming.current = null;
      setProcess(clip.process);
      setWarnings(clip.flags);
      setVideoUrl(URL.createObjectURL(clip.blob));
      setStage("saving");
      await score(await saveVideoSample(id, rubric, clip.blob, clip.process, identity.current, clip.flags));
    } catch {
      f.close();
      filming.current = null;
      onFail();
      setStage("ready");
    }
  };

  const jump = (mmss: string) => {
    const [m, s] = mmss.split(":").map(Number);
    if (player.current) { player.current.currentTime = m * 60 + s; void player.current.play(); }
  };

  const photosAllowed = hasScope(student, "photos");
  const showCamera = stage === "camera" || stage === "filming" || stage === "blurring";
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

      {stage === "rules" && (
        <VideoRules next={rulesNext} onFilm={openCamera} onFile={(f) => void onVideoFile(f)} onCancel={() => setStage("ready")} />
      )}
      {stage === "identity" && <IdentityGate studentId={id} onDone={(x) => void openTaskCamera(x)} />}
      {result?.autoconfirm && (
        <div className={`rounded-2xl p-3 text-sm ${result.autoconfirm.decision === "auto_confirm" ? "bg-good-soft text-good" : "bg-paper text-muted"}`}>
          <p className="font-bold">{result.autoconfirm.decision === "auto_confirm" ? t("systemConfirmed") : t("needsTeacher")}</p>
          {result.identity && <p>{t(`identity_${result.identity.status}` as "identity_verified")}</p>}
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
          {stage === "blurring" && (
            <span className="absolute left-3 top-3 rounded-md bg-brand-dark/80 px-2.5 py-1 font-mono text-sm font-bold text-white">
              {t("blurringUpload", { s: Math.floor(seconds), max: MAX_SECONDS })}
            </span>
          )}
          {live?.paused && (stage === "filming" || stage === "blurring") && (
            <span className="absolute inset-x-3 top-12 rounded-md bg-bad px-2.5 py-1.5 text-center text-sm font-bold text-white">{t("livePaused")}</span>
          )}
        </div>
      )}
      {live && (
        <ul className="flex flex-wrap gap-2 text-sm">
          <li><Pill tone={live.hands > 0 ? "good" : "sun"}>{live.hands > 0 ? t("liveHandsOk") : t("liveNoHands")}</Pill></li>
          {live.dark && <li><Pill tone="sun">{t("liveDark")}</Pill></li>}
          {live.faces >= 2 && <li><Pill tone="sun">{t("liveTwoFaces")}</Pill></li>}
        </ul>
      )}
      {stage === "camera" && <Button onClick={() => void film()}><span className="size-3 rounded-full bg-bad" />{t("startFilming")}</Button>}
      {stage === "filming" && <Button kind="soft" onClick={() => filming.current?.stop()}><Icon name="stop" className="size-5" />{t("stopFilming")}</Button>}

      {preview && <img src={preview} alt="" className="max-h-72 w-full rounded-2xl object-contain" />}
      {videoUrl && <video ref={player} src={videoUrl} controls playsInline className="max-h-72 w-full rounded-2xl bg-black" />}
      {warnings.includes("uploaded") && <p className="rounded-xl bg-paper p-3 text-sm text-muted">{t("uploadTeacher")}</p>}
      {warnings.some((w) => w !== "uploaded") && <p className="rounded-xl bg-paper p-3 text-sm text-muted">{t("liveWarnedTeacher")}</p>}
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
          {/* The checklist says what proof fits the skill: a photo of the result, a video of the process, or either. */}
          {(rubric as { media?: string }).media !== "video" && (
            <>
              <label className={`flex min-h-13 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-base font-bold text-white ${photosAllowed ? "cursor-pointer" : "pointer-events-none opacity-40"}`}>
                <Icon name="camera" className="size-5" />{t("takePhoto")}
                <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!photosAllowed} onChange={(e) => void onPhoto(e.target.files?.[0])} />
              </label>
              <label className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line px-5 text-sm font-bold ${photosAllowed ? "cursor-pointer" : "pointer-events-none opacity-40"}`}>
                <Icon name="layers" className="size-4" />{t("choosePhoto")}
                <input type="file" accept="image/*" className="hidden" disabled={!photosAllowed} onChange={(e) => void onPhoto(e.target.files?.[0])} />
              </label>
            </>
          )}
          {(rubric as { media?: string }).media !== "photo" && (
            <>
              <Button kind={(rubric as { media?: string }).media === "video" ? "primary" : "soft"} disabled={!photosAllowed} onClick={() => showRules("film")}><Icon name="video" className="size-5" />{t("filmTask")}</Button>
              <Button kind="soft" disabled={!photosAllowed} onClick={() => showRules("upload")}><Icon name="layers" className="size-4" />{t("chooseVideo")}</Button>
            </>
          )}
          {cameraError && <p className="rounded-xl bg-sun-soft p-3 text-warn">{t("cameraUnavailable")}</p>}
          {uploadError && <p className="rounded-xl bg-sun-soft p-3 text-warn">{t("videoUnusable")}</p>}
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
