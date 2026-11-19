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

export interface Filming {
  /** Starts recording the blurred canvas; resolves when stopped or after MAX_SECONDS. */
  record(onTick: (seconds: number) => void): Promise<{ blob: Blob; mime: string; process: Process }>;
  stop(): void;
  close(): void;
  hands: boolean;
}

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
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d")!;
  const tiny = document.createElement("canvas");
  tiny.width = 12;
  tiny.height = 12;

  let faces: Box[] = [];
  let hands: NormalizedLandmark[][] = [];
  let frame = 0;
  let raf = 0;
  let recording: { frames: { hands: number; wrist?: [number, number] }[] } | null = null;

  const draw = () => {
    const ts = performance.now();
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const found = models.face.detectForVideo(video, ts).detections
        .map((d) => d.boundingBox).filter((b) => !!b)
        .map((b) => ({ x: b!.originX, y: b!.originY, w: b!.width, h: b!.height, ttl: FACE_HOLD_FRAMES }));
      faces = [...found, ...faces.filter((f) => f.ttl > 0 && !found.some((g) => Math.abs(g.x - f.x) < f.w && Math.abs(g.y - f.y) < f.h))
        .map((f) => ({ ...f, ttl: f.ttl - 1 }))];
    } catch { /* keep the previous boxes */ }
    for (const f of faces) pixelate(ctx, tiny, f);
    if (models.hand && frame % 2 === 0) {
      try { hands = models.hand.detectForVideo(video, ts + 0.5).landmarks; } catch { hands = []; }
    }
    if (hands.length) drawHands(ctx, hands);
    if (recording) recording.frames.push({ hands: hands.length, wrist: hands[0] ? [hands[0][0].x, hands[0][0].y] : undefined });
    frame++;
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  let recorder: MediaRecorder | null = null;
  const close = () => {
    cancelAnimationFrame(raf);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    hands: !!models.hand,
    stop: () => { if (recorder && recorder.state !== "inactive") recorder.stop(); },
    close,
    record(onTick) {
      const mime = pickMime();
      // Only the canvas (with faces already pixelated) is recorded, never the camera stream itself.
      const out = canvas.captureStream(FPS);
      recorder = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 900_000 });
      const chunks: Blob[] = [];
      recording = { frames: [] };
      const t0 = performance.now();
      const tick = window.setInterval(() => {
        const s = (performance.now() - t0) / 1000;
        onTick(s);
        if (s >= MAX_SECONDS) recorder?.stop();
      }, 250);
      return new Promise((resolve, reject) => {
        recorder!.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder!.onerror = () => { window.clearInterval(tick); reject(new Error("recording failed")); };
        recorder!.onstop = () => {
          window.clearInterval(tick);
          const seconds = (performance.now() - t0) / 1000;
          const type = (recorder!.mimeType || mime || "video/webm").split(";")[0];
          const process = summarise(recording?.frames ?? [], seconds);
          recording = null;
          out.getTracks().forEach((t) => t.stop());
          resolve({ blob: new Blob(chunks, { type }), mime: type, process });
        };
        recorder!.start(1000);
      });
    },
  };
}
