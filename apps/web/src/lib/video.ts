// SEE: film a short task with faces blurred on the phone and hands tracked (MediaPipe, on device).
//
// The camera picture is drawn onto a canvas, faces are pixelated there, and only the canvas is recorded, so a
// clear face never reaches the video that is uploaded. If the face model cannot load, filming is refused.
// Hand landmarks give "process" numbers (how much hands are visible, steadiness, activity); the server passes
// them to the AI as context only, and the teacher still confirms every score.

import { FaceDetector, FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

const MODELS = "https://storage.googleapis.com/mediapipe-models";
const FACE_MODEL = `${MODELS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`;
const HAND_MODEL = `${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;

export const MAX_SECONDS = 20;
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

interface Models { face: FaceDetector; hand: HandLandmarker | null }
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
    return { face, hand };
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
}

/** Warnings noted while filming. Sent with the video; they never change the score, only who checks it. */
// "uploaded": chosen from the gallery, not filmed live in Disha, so a teacher always checks it.
export type VideoFlag = "multi_face" | "dark" | "camera_lost" | "tab_away" | "uploaded";

export interface Clip { blob: Blob; mime: string; process: Process; flags: VideoFlag[]; paused_seconds: number }

export interface Filming {
  /** Starts recording the blurred canvas; resolves when stopped or after MAX_SECONDS. */
  record(onTick: (seconds: number) => void): Promise<Clip>;
  stop(): void;
  close(): void;
  live(): LiveStatus;
  hands: boolean;
}

/** How long a condition must last before it counts as a warning (ms). Short blips are ignored. */
const WARN_MS = { multi_face: 1500, dark: 2000 } as const;
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
export async function startFilming(canvas: HTMLCanvasElement): Promise<Filming> {
  const models = await loadModels();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: FPS } }, audio: false });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return run(canvas, video, models, { kind: "camera", stream });
}

/** Longest gallery video we try to open (the first MAX_SECONDS of it are used). */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Opens a video chosen from the gallery. It is played once, hidden, through the same face blur as live filming,
 * and only the blurred copy is recorded: the original file is never uploaded. Only its first MAX_SECONDS are used.
 * Throws if the phone cannot play the file or the face model is not available.
 */
export async function startFromFile(canvas: HTMLCanvasElement, file: Blob): Promise<Filming> {
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
  return run(canvas, video, models, { kind: "file", url });
}

type Source = { kind: "camera"; stream: MediaStream } | { kind: "file"; url: string };

/** The blur-and-check loop shared by live filming and gallery videos. */
function run(canvas: HTMLCanvasElement, video: HTMLVideoElement, models: Models, source: Source): Filming {
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
  const status: LiveStatus = { hands: 0, faces: 0, dark: false, paused: false };
  // Warnings for this recording, and when each condition started (to ignore short blips).
  const flags = new Set<VideoFlag>();
  const since: Partial<Record<"multi_face" | "dark", number>> = {};
  let goodFrames = 0;
  let pausedMs = 0;
  let pausedAt = 0;

  const hold = (key: "multi_face" | "dark", on: boolean, now: number) => {
    if (!on) { delete since[key]; return; }
    since[key] ??= now;
    if (recording && now - since[key]! >= WARN_MS[key]) flags.add(key);
  };
  // Safety pause: if the face model fails, faces might not be blurred, so those frames are not recorded.
  const setPaused = (on: boolean, now: number) => {
    if (on === status.paused) return;
    status.paused = on;
    if (!recorder || recorder.state === "inactive") return;
    if (on && recorder.state === "recording") { recorder.pause(); pausedAt = now; if (source.kind === "file") video.pause(); }
    if (!on && recorder.state === "paused") { recorder.resume(); pausedMs += now - pausedAt; if (source.kind === "file") void video.play(); }
  };

  const draw = () => {
    const ts = performance.now();
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const keep = recording ? FACE_HOLD_RECORDING : FACE_HOLD_FRAMES;
      const found = models.face.detectForVideo(video, ts).detections
        .map((d) => d.boundingBox).filter((b) => !!b)
        .map((b) => ({ x: b!.originX * scale, y: b!.originY * scale, w: b!.width * scale, h: b!.height * scale, ttl: keep }));
      faces = [...found, ...faces.filter((f) => f.ttl > 0 && !found.some((g) => Math.abs(g.x - f.x) < f.w && Math.abs(g.y - f.y) < f.h))
        .map((f) => ({ ...f, ttl: f.ttl - 1 }))];
      status.faces = found.length;
      hold("multi_face", found.length >= 2, ts);
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
    if (models.hand && frame % 2 === 0) {
      try { hands = models.hand.detectForVideo(video, ts + 0.5).landmarks; } catch { hands = []; }
    }
    if (hands.length) drawHands(ctx, hands);
    status.hands = hands.length;
    if (recording && !status.paused) recording.frames.push({ hands: hands.length, wrist: hands[0] ? [hands[0][0].x, hands[0][0].y] : undefined });
    frame++;
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  // Leaving Disha or losing the camera while filming is noted, so a teacher looks at that video.
  const onHide = () => { if (recording && document.hidden) flags.add("tab_away"); };
  const onEnded = () => { if (recording) flags.add("camera_lost"); };
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

  return {
    hands: !!models.hand,
    stop: () => { if (recorder && recorder.state !== "inactive") recorder.stop(); },
    close,
    live: () => ({ ...status }),
    record(onTick) {
      const mime = pickMime();
      // Only the canvas (with faces already pixelated) is recorded, never the camera stream itself.
      const out = canvas.captureStream(FPS);
      recorder = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 900_000 });
      const chunks: Blob[] = [];
      recording = { frames: [] };
      flags.clear();
      if (source.kind === "file") flags.add("uploaded");
      pausedMs = 0;
      const t0 = performance.now();
      // time actually recorded: paused time does not count towards MAX_SECONDS
      const recorded = () => (performance.now() - t0 - pausedMs - (status.paused ? performance.now() - pausedAt : 0)) / 1000;
      const tick = window.setInterval(() => {
        const s = recorded();
        onTick(s);
        if (s >= MAX_SECONDS) recorder?.stop();
      }, 250);
      return new Promise((resolve, reject) => {
        recorder!.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder!.onerror = () => { window.clearInterval(tick); reject(new Error("recording failed")); };
        recorder!.onstop = () => {
          window.clearInterval(tick);
          const seconds = recorded();
          const paused_seconds = Math.round(((performance.now() - t0) / 1000 - seconds) * 10) / 10;
          const type = (recorder!.mimeType || mime || "video/webm").split(";")[0];
          const process = summarise(recording?.frames ?? [], seconds);
          recording = null;
          out.getTracks().forEach((t) => t.stop());
          resolve({ blob: new Blob(chunks, { type }), mime: type, process, flags: [...flags], paused_seconds });
        };
        recorder!.start(1000);
        if (source.kind === "file") { video.currentTime = 0; if (!status.paused) void video.play(); }
        // if blurring is already failing when she presses record, start paused
        if (status.paused) { recorder!.pause(); pausedAt = performance.now(); }
      });
    },
  };
}
