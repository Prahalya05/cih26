// Fair-test check: watches the front camera during a test, entirely on the phone.
//
// MediaPipe's face detector (about 5 times a second) counts faces and estimates where the head is turned from the
// eye and nose key points. An object detector (EfficientDet-Lite0, COCO classes, about once a second) looks for a
// second phone, a book or a second person. Browser events catch leaving the app and pasting. Nothing is recorded or
// uploaded: each answer only carries the names of the warnings that were active while that question was on screen.
//
// Every camera rule needs the condition to last a moment before it counts, so a blink, a hand passing the lens or
// one bad frame on a cheap phone does not raise a warning. The teacher decides what a warning means.

import { FaceDetector, FilesetResolver, ObjectDetector, type Detection } from "@mediapipe/tasks-vision";
import type { CheckMode, Flag } from "./integrity";

const MODELS = "https://storage.googleapis.com/mediapipe-models";
const FACE_MODEL = `${MODELS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`;
const OBJECT_MODEL = `${MODELS}/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite`;

const FACE_EVERY_MS = 200;
const OBJECT_EVERY_MS = 1100;
/** How long a camera condition must last before it becomes a warning. */
const HOLD_MS: Partial<Record<Flag, number>> = { no_face: 2500, look_away: 2500, multi_face: 900, dark: 2000 };
/** Object warnings need this many detections in a row. */
const OBJECT_HITS = 2;
/** Head turn (nose offset from the eye midpoint, in eye widths) that counts as looking away. */
const YAW_LIMIT = 0.6;
const DARK_LUMA = 22;

export interface Incident { kind: Flag; start: number; end: number | null }

export interface Overlay {
  faces: { x: number; y: number; w: number; h: number }[];
  objects: { x: number; y: number; w: number; h: number; label: string }[];
}

export interface Proctor {
  mode: CheckMode;
  /** Warnings active right now. */
  active(): Flag[];
  /** Kinds of warning active at any point since `since` (ms since epoch). */
  flagsSince(since: number): Flag[];
  incidents(): Incident[];
  /** Draws the mirrored camera picture with detection boxes into this canvas (or stops drawing with null). */
  attach(canvas: HTMLCanvasElement | null): void;
  /** Called whenever the active warnings change. */
  subscribe(fn: () => void): () => void;
  close(): void;
}

let fileset: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
let faceModel: Promise<FaceDetector> | null = null;
let objectModel: Promise<ObjectDetector | null> | null = null;

async function withDelegate<T>(make: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  try { return await make("GPU"); } catch { return await make("CPU"); }
}

function loadFace(): Promise<FaceDetector> {
  fileset ??= FilesetResolver.forVisionTasks("/mediapipe");
  faceModel ??= fileset.then((vision) => withDelegate((delegate) => FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: "VIDEO", minDetectionConfidence: 0.5 })));
  faceModel.catch(() => { faceModel = null; fileset = null; });
  return faceModel;
}

/** Optional: the face check still runs if this larger model cannot load (slow network, old phone). */
function loadObjects(): Promise<ObjectDetector | null> {
  fileset ??= FilesetResolver.forVisionTasks("/mediapipe");
  objectModel ??= fileset.then((vision) => withDelegate((delegate) => ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: OBJECT_MODEL, delegate }, runningMode: "VIDEO", scoreThreshold: 0.45, maxResults: 5,
    categoryAllowlist: ["cell phone", "book", "person"] }))).catch(() => null);
  return objectModel;
}

/** How far the head is turned: 0 facing the camera, about ±1 in full profile. Null if key points are missing. */
export function headYaw(d: Detection): number | null {
  const k = d.keypoints;
  if (!k || k.length < 3) return null;
  const [rightEye, leftEye, nose] = k;
  const eyeWidth = Math.abs(leftEye.x - rightEye.x);
  if (eyeWidth < 1e-3) return null;
  return (nose.x - (leftEye.x + rightEye.x) / 2) / eyeWidth;
}

/** Starts the check. With `camera: false` (or if the camera fails) only browser signals are watched. */
export async function startProctor({ camera }: { camera: boolean }): Promise<Proctor> {
  const listeners = new Set<() => void>();
  const incidents: Incident[] = [];
  const open = new Map<Flag, Incident>();
  const since = new Map<Flag, number>(); // when a camera condition first appeared (before it counts)
  const hits = new Map<Flag, number>();  // object detections in a row
  const notify = () => listeners.forEach((fn) => fn());

  const raise = (kind: Flag, at = Date.now()) => {
    if (open.has(kind)) return;
    const inc = { kind, start: at, end: null };
    open.set(kind, inc);
    incidents.push(inc);
    notify();
  };
  const clear = (kind: Flag) => {
    since.delete(kind);
    const inc = open.get(kind);
    if (!inc) return;
    inc.end = Date.now();
    open.delete(kind);
    notify();
  };
  /** A camera condition that must last HOLD_MS before it is raised. */
  const condition = (kind: Flag, present: boolean, now: number) => {
    if (!present) return clear(kind);
    const first = since.get(kind) ?? now;
    since.set(kind, first);
    if (now - first >= (HOLD_MS[kind] ?? 0)) raise(kind, first);
  };
  /** One-off events (pasting) are raised and closed at once. */
  const blip = (kind: Flag) => {
    const now = Date.now();
    incidents.push({ kind, start: now, end: now });
    notify();
  };

  // Browser signals: always on.
  const onVisibility = () => (document.hidden ? raise("tab_away") : clear("tab_away"));
  const onPaste = () => blip("paste");
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("paste", onPaste, true);
  const stopBrowser = () => {
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("paste", onPaste, true);
  };

  const base = {
    active: () => [...open.keys()],
    flagsSince: (t: number) => [...new Set(incidents.filter((i) => i.end === null || i.end >= t).map((i) => i.kind))],
    incidents: () => incidents.slice(),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };

  if (!camera) return { ...base, mode: "browser", attach: () => {}, close: stopBrowser };

  let stream: MediaStream;
  let face: FaceDetector;
  try {
    [face, stream] = await Promise.all([
      loadFace(),
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 24 } }, audio: false }),
    ]);
  } catch (err) {
    stopBrowser();
    throw err;
  }
  void loadObjects(); // starts downloading; used once ready

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  stream.getVideoTracks()[0]?.addEventListener("ended", () => raise("camera_lost"));

  const luma = document.createElement("canvas");
  luma.width = 16;
  luma.height = 12;
  const lumaCtx = luma.getContext("2d", { willReadFrequently: true })!;

  let target: HTMLCanvasElement | null = null;
  const overlay: Overlay = { faces: [], objects: [] };
  let lastFace = 0;
  let lastObject = 0;
  let lastTs = 0;
  let personsUntil = 0; // the object detector saw two people; counts as two faces until then
  let raf = 0;
  let closed = false;

  const brightness = () => {
    lumaCtx.drawImage(video, 0, 0, luma.width, luma.height);
    const px = lumaCtx.getImageData(0, 0, luma.width, luma.height).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    return sum / (px.length / 4);
  };

  const loop = () => {
    if (closed) return;
    const now = Date.now();
    // MediaPipe needs strictly increasing timestamps in VIDEO mode.
    const ts = Math.max(lastTs + 1, performance.now());
    if (video.readyState >= 2 && now - lastFace >= FACE_EVERY_MS) {
      lastFace = now;
      lastTs = ts;
      const dark = brightness() < DARK_LUMA;
      condition("dark", dark, now);
      try {
        const found = face.detectForVideo(video, ts).detections;
        overlay.faces = found.flatMap((d) => (d.boundingBox
          ? [{ x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height }] : []));
        condition("no_face", !dark && found.length === 0, now);
        condition("multi_face", found.length >= 2 || now < personsUntil, now);
        const yaw = found.length === 1 ? headYaw(found[0]) : null;
        condition("look_away", yaw !== null && Math.abs(yaw) > YAW_LIMIT, now);
      } catch { /* skip this frame */ }
    }
    if (video.readyState >= 2 && now - lastObject >= OBJECT_EVERY_MS) {
      lastObject = now;
      void objectModel?.then((det) => {
        if (!det || closed) return;
        const t2 = Math.max(lastTs + 1, performance.now());
        lastTs = t2;
        try {
          const dets = det.detectForVideo(video, t2).detections;
          overlay.objects = dets.flatMap((d) => (d.boundingBox && d.categories[0]?.categoryName !== "person"
            ? [{ x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height, label: d.categories[0].categoryName }] : []));
          const seen = (name: string) => dets.filter((d) => d.categories[0]?.categoryName === name).length;
          const count = (kind: Flag, present: boolean) => {
            const n = present ? (hits.get(kind) ?? 0) + 1 : 0;
            hits.set(kind, n);
            if (n >= OBJECT_HITS) raise(kind); else if (n === 0) clear(kind);
          };
          count("phone", seen("cell phone") > 0);
          count("notes", seen("book") > 0);
          // A second person (even with the face hidden) is the same warning as a second face.
          if (seen("person") >= 2) personsUntil = Date.now() + 1500;
        } catch { /* skip */ }
      });
    }
    if (target) draw(target, video, overlay);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    ...base,
    mode: "camera",
    attach: (c) => { target = c; },
    close: () => {
      closed = true;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      stopBrowser();
    },
  };
}

/** Mirrored selfie preview with a cyan box per face and a red box per phone or book. */
function draw(canvas: HTMLCanvasElement, video: HTMLVideoElement, o: Overlay) {
  const W = video.videoWidth || 480, H = video.videoHeight || 360;
  if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d")!;
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, W, H);
  ctx.lineWidth = Math.max(3, W / 120);
  ctx.strokeStyle = o.faces.length > 1 ? "#f04438" : "#16b3ca";
  for (const f of o.faces) corners(ctx, f.x, f.y, f.w, f.h);
  ctx.strokeStyle = "#f04438";
  for (const b of o.objects) ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.restore();
}

/** Corner brackets instead of a full rectangle: reads as "tracking", not "caught". */
function corners(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const l = Math.min(w, h) * 0.25;
  ctx.beginPath();
  ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
  ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
  ctx.moveTo(x + w, y + h - l); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - l, y + h);
  ctx.moveTo(x + l, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - l);
  ctx.stroke();
}
