// SEE: film a short task with faces blurred on the phone and hands tracked (MediaPipe, on device).
//
// The camera picture is drawn onto a canvas, faces are pixelated there, and only the canvas is recorded, so a
// clear face never reaches the video that is uploaded. If the face model cannot load, filming is refused.
// Hand landmarks give "process" numbers (how much hands are visible, steadiness, activity); the server passes
// them to the AI as context only, and the teacher still confirms every score.

import { FaceDetector, FilesetResolver, HandLandmarker, ObjectDetector, type Detection, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import { xrayIsOn } from "./xray";

const MODELS = "https://storage.googleapis.com/mediapipe-models";
const FACE_MODEL = `${MODELS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`;
const HAND_MODEL = `${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;
// Same object model as the test check (lib/proctor.ts): finds phones, TVs, laptops and people.
const OBJECT_MODEL = `${MODELS}/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite`;
/** Screens that could be showing someone else's work. */
const SCREENS = ["cell phone", "tv", "laptop"];
/** How sure the object model must be before a screen or a person counts. */
const OBJECT_MIN = 0.4;

/** Short task: a normal video, up to 3 minutes. Also the most of a gallery video that is used. */
export const SHORT_SECONDS = 180;
/** Long task: up to an hour, kept as one picture a second, plus a few full-speed clips (see record()). */
export const LONG_SECONDS = 60 * 60;
export const MAX_SECONDS = SHORT_SECONDS;
/** Long task: a short full-speed clip when her hands are busiest, a few times, and the finished work at the end. */
const HIGHLIGHT_SECONDS = 5;
const HIGHLIGHTS_MAX = 5;
const HIGHLIGHT_GAP_S = 120;
const HIGHLIGHT_AFTER_S = 20;
const FINAL_SECONDS = 10;
/** Long task: the camera checks run about 8 times a second instead of every frame, to save battery. */
const LONG_FRAME_MS = 120;
/** A screen or another person that stays in view counts again every 30 s (so 3 minutes is not the same as 3 seconds). */
const REPEAT_MS = 30_000;
const FPS = 15;
const FACE_HOLD_FRAMES = 8; // keep blurring where a face was for a few frames if detection misses one
const FACE_PAD = 0.35; // blur a box this much bigger than the detected face on each side

export interface Process {
  seconds: number;
  hands_visible: number; // share of frames with at least one hand
  two_hands: number;     // share of frames with both hands
  steadiness: number;    // 1 = very steady hand movement, 0 = shaky
  active: number;        // share of frames where a hand is moving
}

interface Models {
  face: FaceDetector; hand: HandLandmarker | null; objects: ObjectDetector | null;
  vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
}

/** What the screen check is doing, shown in X-ray mode and the console, so a failure is visible, not silent. */
export const objectCheck = { state: "loading" as "loading" | "ready" | "failed", delegate: "" as "" | "GPU" | "CPU", error: "" };

function makeObjects(vision: Models["vision"], delegate: "GPU" | "CPU"): Promise<ObjectDetector> {
  // every kind of object at low confidence: the code keeps only screens and people above OBJECT_MIN,
  // and X-ray mode can show everything the model thought it saw (for tuning)
  return ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: OBJECT_MODEL, delegate }, runningMode: "VIDEO", scoreThreshold: 0.15, maxResults: 10 });
}
let loading: Promise<Models> | null = null;

async function create<T>(make: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  try { return await make("GPU"); } catch { return await make("CPU"); }
}

/** Loads the face detector (required) and the hand landmarker (optional). Cached after the first call. */
export function loadModels(): Promise<Models> {
  loading ??= (async () => {
    const vision = await FilesetResolver.forVisionTasks("/mediapipe");
    const face = await create((delegate) => FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: "VIDEO", minDetectionConfidence: 0.35 }));
    let hand: HandLandmarker | null = null;
    try {
      hand = await create((delegate) => HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: "VIDEO", numHands: 2 }));
    } catch { /* filming still works without hand tracking */ }
    let objects: ObjectDetector | null = null;
    // CPU only: this is the int8 model, made for the processor. On some laptops' graphics chips it loads and runs
    // without an error but finds nothing at all (seen on a Windows laptop: "ready GPU · 0 seen" with a person in view).
    for (const delegate of ["CPU"] as const) {
      try {
        objects = await makeObjects(vision, delegate);
        Object.assign(objectCheck, { state: "ready", delegate, error: "" });
        console.info(`Disha: screen check ready (${delegate})`);
        break;
      } catch (e) {
        Object.assign(objectCheck, { state: "failed", delegate: "", error: String(e).slice(0, 120) });
      }
    }
    // filming still works without the screen check
    if (!objects) console.warn("Disha: screen check unavailable", objectCheck.error);
    return { face, hand, objects, vision };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

function pickMime(): string {
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

type Box = { x: number; y: number; w: number; h: number; ttl: number };

function pixelate(ctx: CanvasRenderingContext2D, tiny: HTMLCanvasElement, b: Box) {
  const x = Math.max(0, Math.floor(b.x - b.w * FACE_PAD));
  const y = Math.max(0, Math.floor(b.y - b.h * FACE_PAD));
  const w = Math.min(ctx.canvas.width - x, Math.ceil(b.w * (1 + 2 * FACE_PAD)));
  const h = Math.min(ctx.canvas.height - y, Math.ceil(b.h * (1 + 2 * FACE_PAD)));
  if (w <= 0 || h <= 0) return;
  const t = tiny.getContext("2d")!;
  t.imageSmoothingEnabled = true;
  t.drawImage(ctx.canvas, x, y, w, h, 0, 0, tiny.width, tiny.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

function drawHands(ctx: CanvasRenderingContext2D, hands: NormalizedLandmark[][]) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.lineWidth = Math.max(2, W / 320);
  hands.forEach((pts, i) => {
    ctx.strokeStyle = i === 0 ? "#14b8a6" : "#f59e0b";
    ctx.fillStyle = ctx.strokeStyle;
    for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(pts[start].x * W, pts[start].y * H);
      ctx.lineTo(pts[end].x * W, pts[end].y * H);
      ctx.stroke();
    }
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, ctx.lineWidth * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Turns per-frame hand observations into the summary sent with the video. */
export function summarise(frames: { hands: number; wrist?: [number, number] }[], seconds: number): Process {
  const n = Math.max(1, frames.length);
  const steps: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].wrist, b = frames[i].wrist;
    if (a && b) steps.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const mean = steps.reduce((s, d) => s + d, 0) / Math.max(1, steps.length);
  const sd = Math.sqrt(steps.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, steps.length));
  const r = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
  return {
    seconds: Math.round(seconds * 10) / 10,
    hands_visible: r(frames.filter((f) => f.hands > 0).length / n),
    two_hands: r(frames.filter((f) => f.hands > 1).length / n),
    steadiness: steps.length ? r(1 - sd / 0.03) : 0,
    active: steps.length ? r(steps.filter((d) => d > 0.004).length / steps.length) : 0,
  };
}

/** What the phone sees right now, for live hints. Nothing here leaves the phone. */
export interface LiveStatus {
  hands: number;        // hands in view now
  faces: number;        // faces in view now (all are blurred)
  dark: boolean;        // too dark to see the work
  paused: boolean;      // recording paused because blurring could not be trusted
  screen: boolean;      // another phone, TV or laptop screen in view
  finishing: boolean;   // long task: recording the finished work at full speed before stopping
}

/** Warnings noted while filming. Sent with the video; they never change the score, only who checks it. */
// "uploaded": chosen from the gallery, not filmed live in Disha, so a teacher always checks it.
// "screen": another phone, TV or laptop in view, which could be playing someone else's work.
// "no_hands": no hands seen for a few seconds. It lowers the trust score a little but does not, by itself,
// send the video to a teacher.
export type VideoFlag = "multi_face" | "dark" | "camera_lost" | "tab_away" | "uploaded" | "screen" | "no_hands";

/** A warning and the moment (seconds into the recording) it started; sent so the AI can look closely there. */
export interface Moment { kind: VideoFlag; at: number }

export interface Clip {
  blob: Blob; mime: string; process: Process;
  /** kinds seen at least once (except no_hands); any of these sends the video to a teacher */
  flags: VideoFlag[];
  /** how many times each warning happened: the trust score is worked out from these (engine trustScore) */
  counts: Partial<Record<VideoFlag, number>>;
  moments: Moment[];
  paused_seconds: number;
  mode: "short" | "long";
  /** long task only: full-speed clips (busiest moments, and the finished work at the end); `at` is seconds in */
  clips: { blob: Blob; at: number; seconds: number; why: "active" | "final" }[];
}

export interface Filming {
  /**
   * Starts recording the blurred canvas; resolves when stopped or at the time limit. A long task keeps one
   * picture a second; each saved part is passed to onPart as it is made, so a crash does not lose everything.
   * stop() on a long task first records the finished work at full speed for FINAL_SECONDS.
   */
  record(onTick: (seconds: number) => void, onPart?: (part: Blob) => void): Promise<Clip>;
  stop(): void;
  close(): void;
  live(): LiveStatus;
  hands: boolean;
}

/** How long a condition must last before it counts as a warning (ms). Short blips are ignored. */
const WARN_MS = { multi_face: 1500, dark: 2000, screen: 2000, no_hands: 3000 } as const;
/** The object model is slower, so it looks about twice a second. */
const OBJECT_EVERY = 8;
/** A screen counts as still there this long after it was last seen, so one missed look does not reset the warning. */
const SCREEN_STICKY_MS = 1500;
/** While recording, a lost face box stays blurred this many frames (about 1.5 s), longer than in the preview. */
const FACE_HOLD_RECORDING = 24;
/** Frames in a row the face model must work again before a safety pause ends. */
const RESUME_AFTER = 5;
/** Average brightness (0-255) below which the picture counts as dark. */
const DARK_LEVEL = 35;

/**
 * Opens the back camera and starts drawing the blurred preview into `canvas`.
 * Throws if the camera or the face model is not available (then nothing can be filmed).
 */
/**
 * What this task needs in the picture, from the checklist's "video_allows":
 * screensAllowed: the work itself is on a screen (computer basics); othersAllowed: a friend or child takes part
 * (selling, teaching, first aid). Their faces are still blurred; they are just not a warning.
 */
export interface FilmOptions { screensAllowed?: boolean; othersAllowed?: boolean; mode?: "short" | "long" }

export async function startFilming(canvas: HTMLCanvasElement, opts: FilmOptions = {}): Promise<Filming> {
  const models = await loadModels();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: FPS } }, audio: false });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return run(canvas, video, models, { kind: "camera", stream }, opts);
}

/** Longest gallery video we try to open (the first MAX_SECONDS of it are used). */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Opens a video chosen from the gallery. It is played once, hidden, through the same face blur as live filming,
 * and only the blurred copy is recorded: the original file is never uploaded. Only its first MAX_SECONDS are used.
 * Throws if the phone cannot play the file or the face model is not available.
 */
export async function startFromFile(canvas: HTMLCanvasElement, file: Blob, opts: FilmOptions = {}): Promise<Filming> {
  if (!file.type.startsWith("video/") || file.size > MAX_UPLOAD_BYTES) throw new Error("not a usable video");
  const models = await loadModels();
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; // the sound is never used
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("cannot play this video"));
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return run(canvas, video, models, { kind: "file", url }, opts);
}

type Source = { kind: "camera"; stream: MediaStream } | { kind: "file"; url: string };

/** The blur-and-check loop shared by live filming and gallery videos. */
function run(canvas: HTMLCanvasElement, video: HTMLVideoElement, models: Models, source: Source, opts: FilmOptions): Filming {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  // big gallery videos are drawn at most 640 px wide (the camera is already 640 x 480)
  const scale = Math.min(1, 640 / vw);
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d")!;
  const tiny = document.createElement("canvas");
  tiny.width = 12;
  tiny.height = 12;

  let faces: Box[] = [];
  let hands: NormalizedLandmark[][] = [];
  let frame = 0;
  let raf = 0;
  let recording: { frames: { hands: number; wrist?: [number, number] }[] } | null = null;
  let recorder: MediaRecorder | null = null;
  const light = document.createElement("canvas");
  light.width = 16;
  light.height = 12;
  const lightCtx = light.getContext("2d", { willReadFrequently: true })!;
  const status: LiveStatus = { hands: 0, faces: 0, dark: false, paused: false, screen: false, finishing: false };
  const long = opts.mode === "long" && source.kind === "camera";
  let people = 0; // people seen by the object model, even with the face hidden
  let screenSeenAt = -Infinity;
  let screenBoxes: { x: number; y: number; w: number; h: number }[] = [];
  // X-ray (demo) mode: show every guess of the object model with its confidence. Drawn on the picture, so it is
  // in the recording too; only for testing.
  const debug = xrayIsOn();
  let guesses: Detection[] = [];
  let objTs = 0;
  let objErrors = 0;
  // Warnings for this recording: how many times each happened, and when. A condition that lasts counts once,
  // and counts again only after it has cleared and come back (one long dark spell is one warning, not hundreds).
  const counts: Partial<Record<VideoFlag, number>> = {};
  const moments: Moment[] = [];
  const since: Partial<Record<keyof typeof WARN_MS, number>> = {};
  const counted: Partial<Record<keyof typeof WARN_MS, boolean>> = {};
  const countedAt: Partial<Record<keyof typeof WARN_MS, number>> = {};
  let goodFrames = 0;
  let pausedMs = 0;
  let pausedAt = 0;
  let t0 = 0;
  // seconds actually recorded so far: paused time does not count
  const recordedSeconds = () => (performance.now() - t0 - pausedMs - (status.paused ? performance.now() - pausedAt : 0)) / 1000;

  const note = (kind: VideoFlag) => {
    if (!recording || status.paused) return;
    counts[kind] = Math.min(99, (counts[kind] ?? 0) + 1);
    if (moments.length < 60) moments.push({ kind, at: Math.max(0, Math.round(recordedSeconds())) });
  };
  const hold = (key: keyof typeof WARN_MS, on: boolean, now: number) => {
    if (!on) { delete since[key]; counted[key] = false; return; }
    since[key] ??= now;
    if (recording && !counted[key] && now - since[key]! >= WARN_MS[key]) { counted[key] = true; countedAt[key] = now; note(key); }
    // a screen or another person that stays counts again every REPEAT_MS
    else if (recording && counted[key] && (key === "screen" || key === "multi_face") && now - countedAt[key]! >= REPEAT_MS) {
      countedAt[key] = now;
      note(key);
    }
  };
  // Safety pause: if the face model fails, faces might not be blurred, so those frames are not recorded.
  const setPaused = (on: boolean, now: number) => {
    if (on === status.paused) return;
    status.paused = on;
    if (!recorder || recorder.state === "inactive") return;
    if (on && recorder.state === "recording") { recorder.pause(); pausedAt = now; if (source.kind === "file") video.pause(); }
    if (!on && recorder.state === "paused") { recorder.resume(); pausedMs += now - pausedAt; if (source.kind === "file") void video.play(); }
    // a full-speed clip records the same picture, so it pauses too
    if (clipRec?.recorder.state === "recording" && on) clipRec.recorder.pause();
    if (clipRec?.recorder.state === "paused" && !on) clipRec.recorder.resume();
  };

  // ---------- long task: one picture a second, the best of that second, plus a few full-speed clips ----------
  const keepCanvas = document.createElement("canvas");
  const bestCanvas = document.createElement("canvas");
  keepCanvas.width = bestCanvas.width = canvas.width;
  keepCanvas.height = bestCanvas.height = canvas.height;
  const keepCtx = keepCanvas.getContext("2d")!;
  const bestCtx = bestCanvas.getContext("2d")!;
  let keepTrack: (MediaStreamTrack & { requestFrame?: () => void }) | null = null;
  let bestSecond = -1;
  let bestScore = -Infinity;
  let activity = 0;
  let lastWrist: [number, number] | null = null;
  let lastClipAt = -Infinity;
  let clipRec: { recorder: MediaRecorder; done: Promise<void> } | null = null;
  const clips: Clip["clips"] = [];

  // The picture kept for each second is the one where her hands show best (and it is not dark): already blurred.
  const keepLong = () => {
    const sec = Math.floor(recordedSeconds());
    if (sec !== bestSecond) {
      if (bestSecond >= 0) { keepCtx.drawImage(bestCanvas, 0, 0); keepTrack?.requestFrame?.(); }
      bestSecond = sec;
      bestScore = -Infinity;
    }
    const score = hands.length * 2 - (status.dark ? 1 : 0) - (status.screen ? 1 : 0);
    if (score >= bestScore) { bestCtx.drawImage(canvas, 0, 0); bestScore = score; }
    // how busy her hands are: share of recent looks where the wrist moved (same step as summarise's "active")
    const w = hands[0]?.[0];
    const moved = w && lastWrist ? Math.hypot(w.x - lastWrist[0], w.y - lastWrist[1]) > 0.004 : false;
    lastWrist = w ? [w.x, w.y] : null;
    activity = 0.85 * activity + 0.15 * (moved ? 1 : 0);
    const busy = clips.filter((c) => c.why === "active").length;
    if (!clipRec && !status.finishing && activity > 0.6 && busy < HIGHLIGHTS_MAX && sec >= HIGHLIGHT_AFTER_S && sec - lastClipAt >= HIGHLIGHT_GAP_S) {
      lastClipAt = sec;
      startClip("active", HIGHLIGHT_SECONDS);
    }
  };

  // A full-speed clip of the blurred picture, recorded alongside the one-a-second video.
  const startClip = (why: "active" | "final", seconds: number): Promise<void> => {
    const at = Math.max(0, Math.round(recordedSeconds()));
    const mime = pickMime();
    const out = canvas.captureStream(FPS);
    const rec = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 900_000 });
    const chunks: Blob[] = [];
    const done = new Promise<void>((resolve) => {
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        out.getTracks().forEach((t) => t.stop());
        const type = (rec.mimeType || mime || "video/webm").split(";")[0];
        if (chunks.length) clips.push({ blob: new Blob(chunks, { type }), at, seconds, why });
        clipRec = null;
        resolve();
      };
      rec.onerror = () => rec.onstop?.(new Event("stop"));
    });
    rec.start();
    if (status.paused) rec.pause();
    window.setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, seconds * 1000);
    clipRec = { recorder: rec, done };
    return done;
  };

  let lastDraw = 0;
  const draw = () => {
    const ts = performance.now();
    if (long && ts - lastDraw < LONG_FRAME_MS) { raf = requestAnimationFrame(draw); return; }
    lastDraw = ts;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const keep = recording ? FACE_HOLD_RECORDING : FACE_HOLD_FRAMES;
      const found = models.face.detectForVideo(video, ts).detections
        .map((d) => d.boundingBox).filter((b) => !!b)
        .map((b) => ({ x: b!.originX * scale, y: b!.originY * scale, w: b!.width * scale, h: b!.height * scale, ttl: keep }));
      faces = [...found, ...faces.filter((f) => f.ttl > 0 && !found.some((g) => Math.abs(g.x - f.x) < f.w && Math.abs(g.y - f.y) < f.h))
        .map((f) => ({ ...f, ttl: f.ttl - 1 }))];
      status.faces = found.length;
      // a second person counts even when only their body is seen
      hold("multi_face", !opts.othersAllowed && (found.length >= 2 || people >= 2), ts);
      if (status.paused && ++goodFrames >= RESUME_AFTER) setPaused(false, ts);
    } catch {
      // keep the previous boxes, and stop recording until the model works again
      goodFrames = 0;
      setPaused(true, ts);
    }
    for (const f of faces) pixelate(ctx, tiny, f);
    if (frame % 10 === 0) {
      // average brightness of a tiny copy of the picture (read and thrown away at once)
      lightCtx.drawImage(video, 0, 0, light.width, light.height);
      const px = lightCtx.getImageData(0, 0, light.width, light.height).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
      status.dark = sum / (px.length / 4) < DARK_LEVEL;
    }
    hold("dark", status.dark, ts);
    if (models.objects && frame % OBJECT_EVERY === 1) {
      // its own whole-millisecond, strictly increasing clock (as lib/proctor.ts does)
      objTs = Math.max(objTs + 1, Math.round(ts));
      try {
        const all = models.objects.detectForVideo(video, objTs).detections;
        objErrors = 0;
        guesses = all;
        const dets = all.filter((d) => (d.categories[0]?.score ?? 0) >= OBJECT_MIN);
        people = dets.filter((d) => d.categories[0]?.categoryName === "person").length;
        const screens = opts.screensAllowed ? [] : dets.filter((d) => SCREENS.includes(d.categories[0]?.categoryName ?? "") && d.boundingBox);
        screenBoxes = screens.map((d) => ({ x: d.boundingBox!.originX * scale, y: d.boundingBox!.originY * scale,
          w: d.boundingBox!.width * scale, h: d.boundingBox!.height * scale }));
        if (screens.length) screenSeenAt = ts;
      } catch (e) {
        // A model can load on the graphics chip and then fail on every frame (some laptops). After a few failures
        // in a row, start it again on the processor instead, and say so.
        objectCheck.error = String(e).slice(0, 120);
        if (++objErrors === 3) {
          console.warn("Disha: screen check failing", objectCheck.error);
          if (objectCheck.delegate === "GPU") {
            const broken = models.objects;
            models.objects = null;
            objectCheck.state = "loading";
            void makeObjects(models.vision, "CPU").then((m) => {
              models.objects = m;
              Object.assign(objectCheck, { state: "ready", delegate: "CPU", error: "" });
              console.info("Disha: screen check moved to CPU");
              broken?.close();
            }).catch((err) => { Object.assign(objectCheck, { state: "failed", error: String(err).slice(0, 120) }); });
          } else {
            objectCheck.state = "failed";
          }
        }
      }
    }
    status.screen = ts - screenSeenAt < SCREEN_STICKY_MS;
    if (!status.screen) screenBoxes = [];
    hold("screen", status.screen, ts);
    if (debug) {
      ctx.font = `${Math.max(12, canvas.width / 40)}px monospace`;
      // status line: is the screen check loaded, on which chip, and the last error if any
      const line = `screen check: ${models.objects ? objectCheck.state : objectCheck.state === "loading" ? "loading" : "off"} ${objectCheck.delegate}` +
        ` · ${guesses.length} seen${objectCheck.error ? ` · ${objectCheck.error}` : ""}`;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, canvas.height - 22, canvas.width, 22);
      ctx.fillStyle = "#facc15";
      ctx.fillText(line, 6, canvas.height - 6);
      ctx.lineWidth = 1;
      for (const g of guesses) {
        const b = g.boundingBox, c = g.categories[0];
        if (!b || !c) continue;
        ctx.strokeStyle = ctx.fillStyle = "#facc15";
        ctx.strokeRect(b.originX * scale, b.originY * scale, b.width * scale, b.height * scale);
        ctx.fillText(`${c.categoryName} ${c.score.toFixed(2)}`, b.originX * scale + 4, b.originY * scale + 16);
      }
    }
    // red box around a screen that is seen, so she knows what to move away
    if (screenBoxes.length) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = Math.max(2, canvas.width / 200);
      for (const b of screenBoxes) ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
    if (models.hand && frame % 2 === 0) {
      try { hands = models.hand.detectForVideo(video, ts + 0.5).landmarks; } catch { hands = []; }
    }
    if (hands.length) drawHands(ctx, hands);
    status.hands = hands.length;
    if (models.hand) hold("no_hands", hands.length === 0, ts);
    if (recording && !status.paused) recording.frames.push({ hands: hands.length, wrist: hands[0] ? [hands[0][0].x, hands[0][0].y] : undefined });
    if (long && recording && !status.paused) keepLong();
    frame++;
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  // Leaving Disha or losing the camera while filming is noted, so a teacher looks at that video.
  const onHide = () => { if (document.hidden) note("tab_away"); };
  const onEnded = () => note("camera_lost");
  document.addEventListener("visibilitychange", onHide);
  if (source.kind === "camera") source.stream.getVideoTracks().forEach((t) => t.addEventListener("ended", onEnded));
  // a gallery video stops recording when it ends
  else video.addEventListener("ended", () => { if (recorder && recorder.state !== "inactive") recorder.stop(); });

  const close = () => {
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onHide);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (source.kind === "camera") source.stream.getTracks().forEach((t) => t.stop());
    else { video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(source.url); }
  };

  // Long task: "Finish" records the finished work at full speed for FINAL_SECONDS, then stops.
  const finish = () => {
    status.finishing = true;
    const stopAll = () => { if (recorder && recorder.state !== "inactive") recorder.stop(); };
    if (clipRec) { clipRec.recorder.stop(); void clipRec.done.then(() => startClip("final", FINAL_SECONDS).then(stopAll)); }
    else void startClip("final", FINAL_SECONDS).then(stopAll);
  };

  return {
    hands: !!models.hand,
    stop: () => {
      if (!recorder || recorder.state === "inactive") return;
      if (long && !status.finishing) { finish(); return; }
      recorder.stop();
    },
    close,
    live: () => ({ ...status }),
    record(onTick, onPart) {
      const mime = pickMime();
      // Only the canvas (with faces already pixelated) is recorded, never the camera stream itself.
      // A long task records a second canvas that gets one picture a second (requestFrame), at a low bit rate.
      const out = long ? keepCanvas.captureStream(0) : canvas.captureStream(FPS);
      if (long) keepTrack = out.getVideoTracks()[0] as typeof keepTrack;
      recorder = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: long ? 100_000 : 600_000 });
      const limit = long ? LONG_SECONDS : MAX_SECONDS;
      const chunks: Blob[] = [];
      recording = { frames: [] };
      for (const k of Object.keys(counts)) delete counts[k as VideoFlag];
      moments.length = 0;
      for (const k of Object.keys(counted)) counted[k as keyof typeof WARN_MS] = false;
      clips.length = 0;
      bestSecond = -1;
      lastClipAt = -Infinity;
      status.finishing = false;
      // keep the screen on during a long task, so the phone does not sleep and stop the camera
      let wake: WakeLockSentinel | null = null;
      if (long && "wakeLock" in navigator) void navigator.wakeLock.request("screen").then((w) => { wake = w; }).catch(() => undefined);
      if (source.kind === "file") counts.uploaded = 1;
      pausedMs = 0;
      t0 = performance.now();
      const recorded = recordedSeconds;
      const tick = window.setInterval(() => {
        const s = recorded();
        onTick(s);
        if (s >= limit) { if (long) { if (!status.finishing) finish(); } else recorder?.stop(); }
      }, 250);
      return new Promise((resolve, reject) => {
        recorder!.ondataavailable = (e) => { if (e.data.size) { chunks.push(e.data); if (long) onPart?.(e.data); } };
        recorder!.onerror = () => { window.clearInterval(tick); reject(new Error("recording failed")); };
        recorder!.onstop = async () => {
          window.clearInterval(tick);
          if (clipRec) { clipRec.recorder.stop(); await clipRec.done; }
          void (wake as WakeLockSentinel | null)?.release().catch(() => undefined);
          status.finishing = false;
          const seconds = recorded();
          const paused_seconds = Math.round(((performance.now() - t0) / 1000 - seconds) * 10) / 10;
          const type = (recorder!.mimeType || mime || "video/webm").split(";")[0];
          const process = summarise(recording?.frames ?? [], seconds);
          recording = null;
          out.getTracks().forEach((t) => t.stop());
          const flags = (Object.keys(counts) as VideoFlag[]).filter((k) => k !== "no_hands" && (counts[k] ?? 0) > 0);
          resolve({ blob: new Blob(chunks, { type }), mime: type, process, flags, counts: { ...counts }, moments: [...moments],
            paused_seconds, mode: long ? "long" : "short", clips: [...clips] });
        };
        // a long task hands over a saved part every 10 s (crash safety); a short one keeps parts in memory
        recorder!.start(long ? 10_000 : 1000);
        if (long) { keepCtx.drawImage(canvas, 0, 0); keepTrack?.requestFrame?.(); }
        if (source.kind === "file") { video.currentTime = 0; if (!status.paused) void video.play(); }
        // if blurring is already failing when she presses record, start paused
        if (status.paused) { recorder!.pause(); pausedAt = performance.now(); }
      });
    },
  };
}
