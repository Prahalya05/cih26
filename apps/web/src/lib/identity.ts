// Is it really her doing the task? (rule.identity) Everything here runs on the phone.
//
// 1. Enrol once: three selfies give a 128-number face descriptor (face-api). It is kept only in this phone's storage,
//    never uploaded, and deleted with her profile.
// 2. Before filming: the front camera checks for ~3 seconds. She must show a random number of fingers (liveness,
//    counted with MediaPipe hand landmarks) while her face is compared with the enrolled descriptor.
// 3. Only numbers leave the phone: per-frame face distances, how many frames were sampled, fingers asked and seen.
//    The server re-runs the same rule on them (services/trust.py).

import type { IdentityInput } from "@disha/engine";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { db } from "./db";
import { loadModels } from "./video";

type FaceApi = typeof import("@vladmandic/face-api");
let api: Promise<FaceApi> | null = null;

function faceApi(): Promise<FaceApi> {
  api ??= (async () => {
    const f = await import("@vladmandic/face-api");
    await Promise.all([
      f.nets.tinyFaceDetector.loadFromUri("/face-models"),
      f.nets.faceLandmark68TinyNet.loadFromUri("/face-models"),
      f.nets.faceRecognitionNet.loadFromUri("/face-models"),
    ]);
    return f;
  })();
  api.catch(() => { api = null; });
  return api;
}

const key = (studentId: string) => `face:${studentId}`;

export async function hasEnrolledFace(studentId: string): Promise<boolean> {
  return !!(await db.meta.get(key(studentId)));
}

export async function forgetFace(studentId: string) {
  await db.meta.delete(key(studentId));
}

async function descriptorOf(f: FaceApi, video: HTMLVideoElement): Promise<Float32Array | null> {
  const r = await f.detectSingleFace(video, new f.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 }))
    .withFaceLandmarks(true).withFaceDescriptor();
  return r?.descriptor ?? null;
}

export async function openFrontCamera(video: HTMLVideoElement): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 } }, audio: false });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return () => stream.getTracks().forEach((t) => t.stop());
}

/** Takes up to 3 good face pictures and keeps their average descriptor on the phone. */
export async function enrolFace(studentId: string, video: HTMLVideoElement): Promise<boolean> {
  const f = await faceApi();
  const got: Float32Array[] = [];
  for (let i = 0; i < 12 && got.length < 3; i++) {
    const d = await descriptorOf(f, video);
    if (d) got.push(d);
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!got.length) return false;
  const avg = Array.from(got[0]).map((_, k) => got.reduce((s, d) => s + d[k], 0) / got.length);
  await db.meta.put({ key: key(studentId), value: avg });
  return true;
}

/** Fingers held up on one hand (0-5), from MediaPipe's 21 hand landmarks. */
export function countFingers(lm: NormalizedLandmark[]): number {
  if (lm.length < 21) return 0;
  let n = 0;
  // index, middle, ring, little: tip above the middle joint (image y grows downwards)
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) if (lm[tip].y < lm[pip].y - 0.02) n++;
  // thumb: tip far from the index knuckle sideways
  if (Math.abs(lm[4].x - lm[5].x) > Math.abs(lm[3].x - lm[5].x) + 0.02 && Math.hypot(lm[4].x - lm[9].x, lm[4].y - lm[9].y) > 0.18) n++;
  return n;
}

export const randomFingers = () => 1 + Math.floor(Math.random() * 4); // 1-4

/** Watches the front camera for `ms`: face distance per frame and the most common finger count. */
export async function checkIdentity(studentId: string, video: HTMLVideoElement, asked: number, ms = 3500,
  onFrame?: (x: { fingers: number; distance: number | null }) => void): Promise<IdentityInput> {
  const saved = (await db.meta.get(key(studentId)))?.value as number[] | undefined;
  const f = await faceApi();
  const models = await loadModels().catch(() => null);
  const distances: number[] = [];
  const counts: number[] = [];
  let sampled = 0;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    sampled++;
    const d = await descriptorOf(f, video);
    const dist = d && saved ? f.euclideanDistance(Array.from(d), saved) : null;
    if (dist !== null) distances.push(Math.round(dist * 1000) / 1000);
    let fingers = 0;
    if (models?.hand) {
      try {
        const hands = models.hand.detectForVideo(video, performance.now()).landmarks;
        fingers = Math.max(0, ...hands.map(countFingers));
        if (hands.length) counts.push(fingers);
      } catch { /* no hand this frame */ }
    }
    onFrame?.({ fingers, distance: dist });
    await new Promise((r) => setTimeout(r, 120));
  }
  const mode = counts.length ? [...counts].sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0] : null;
  return { enrolled: !!saved, distances, sampled, liveness: { asked, seen: mode } };
}
