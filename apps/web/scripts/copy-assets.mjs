// Copies the MediaPipe vision WebAssembly runtime from node_modules into public/mediapipe, so the phone loads it
// from Disha's own address (same version as the npm package). The face and hand models are fetched from Google's
// model bucket on first use and cached by the browser. Run before dev and build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve("@mediapipe/tasks-vision")), "wasm");
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "mediapipe");
mkdirSync(out, { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  const to = join(out, f);
  if (!existsSync(to)) copyFileSync(join(src, f), to);
}

// Face-api models for the identity check (rule.identity): tiny face detector, 68 landmarks (tiny) and the 128-number
// face descriptor. About 6.5 MB, loaded only when a student enrols her face or films a task.
const faceSrc = join(dirname(require.resolve("@vladmandic/face-api/package.json")), "model");
const faceOut = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "face-models");
mkdirSync(faceOut, { recursive: true });
for (const m of ["tiny_face_detector_model", "face_landmark_68_tiny_model", "face_recognition_model"]) {
  for (const f of [`${m}-weights_manifest.json`, `${m}.bin`]) {
    const to = join(faceOut, f);
    if (!existsSync(to)) copyFileSync(join(faceSrc, f), to);
  }
}
