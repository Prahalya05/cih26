import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const kbDir = fileURLToPath(new URL("../../packages/kb", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@kb": kbDir } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Disha — career guide",
        short_name: "Disha",
        description: "Find your strengths, careers and scholarships. Works offline.",
        lang: "ta",
        theme_color: "#0f766e",
        background_color: "#fffbf5",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell + knowledge base are bundled, so the whole student flow works offline.
        globPatterns: ["**/*.{js,css,html,svg,mp3,json}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/v1\//, /^\/docs/, /^\/health/],
      },
    }),
  ],
  server: {
    proxy: { "/v1": "http://127.0.0.1:8000", "/health": "http://127.0.0.1:8000" },
  },
});
