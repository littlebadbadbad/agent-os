/**
 * extensions/token-budget/vite.ui.config.ts
 *
 * Vite build config for the token-budget plugin's UI entry.
 *
 * - Input:  ui/index.html
 * - Output: ${PLUGIN_OUT_DIR}/ui/  (self-contained HTML + JS + CSS)
 * - Target: es2022 (modern browsers)
 * - React JSX via @vitejs/plugin-react
 * - @agent-type alias resolves to the workspace's agent-type/ directory
 *
 * Usage:
 *   npx vite build --config vite.ui.config.ts
 *
 * Or via the build script (scripts/build.mjs) which sets PLUGIN_OUT_DIR.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const outDir = process.env.PLUGIN_OUT_DIR
  ? resolve(process.env.PLUGIN_OUT_DIR, "ui")
  : resolve(__dirname, "..", "..", "plugins", "token-budget", "ui");

export default defineConfig({
  root: resolve(__dirname, "ui"),
  base: "./",
  resolve: {
    alias: {
      "@agent-type": resolve(__dirname, "..", "..", "agent-type", "index.ts"),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, "ui", "index.html"),
    },
  },
  plugins: [react()],
});
