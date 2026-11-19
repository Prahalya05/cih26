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
