import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

registerSW({ immediate: true });

// After a deploy, an open tab still runs the old build and asks for chunk names that no longer
// exist (the new service worker has cleared them, the server never had them). Reload once to pick
// up the new build instead of showing a blank page. The timestamp guard stops a reload loop if the
// chunk is genuinely missing.
window.addEventListener("vite:preloadError", (event) => {
  const key = "disha-chunk-reload";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(key)) || 0;
  } catch {
    /* storage blocked: still reload once */
  }
  if (Date.now() - last < 10_000) return;
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* ignore */
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
