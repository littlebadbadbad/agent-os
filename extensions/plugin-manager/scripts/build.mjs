#!/usr/bin/env node
/**
 * extensions/plugin-manager/scripts/build.mjs  —  Plugin Manager build script.
 *
 * Compiles the plugin-manager plugin's agent entry, backend entry, and UI
 * entry into the plugin output directory (PLUGIN_OUT_DIR or default
 * ../../plugins/plugin-manager).
 *
 * Entries:
 *   agent/activate.ts   → activate.js       (esbuild, browser sandbox, es2022, esm)
 *   backend/index.js    → backend.cjs        (copy, CommonJS for Node.js)
 *   ui/index.html       → ui/index.html     (Vite, self-contained HTML+JS+CSS)
 *
 * Usage (from extensions/plugin-manager/):
 *   node scripts/build.mjs
 *
 * Or via the orchestrator:
 *   node scripts/compile-plugins.mjs
 */

import esbuild from "esbuild";
import { execSync } from "child_process";
import { existsSync, copyFileSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Plugin source root: extensions/plugin-manager/ */
const SRC_DIR = resolve(__dirname, "..");

/** Output directory: from env var (set by compile-plugins.mjs), or default. */
const OUT_DIR =
  process.env.PLUGIN_OUT_DIR ??
  resolve(SRC_DIR, "..", "..", "plugins", "plugin-manager");

const ENTRIES = [
  {
    src: "agent/activate.ts",
    out: "activate.js",
    platform: "browser",
    target: "es2022",
    format: "esm",
  },
];

let builtCount = 0;

for (const { src, out, platform, target, format } of ENTRIES) {
  const entryFile = resolve(SRC_DIR, src);

  if (!existsSync(entryFile)) {
    console.log(`  ℹ  plugin-manager: source not found — ${src}`);
    continue;
  }

  console.log(`  ┊  plugin-manager: ${src} → ${out} (${platform})`);

  try {
    await esbuild.build({
      entryPoints: [entryFile],
      outfile: resolve(OUT_DIR, out),
      bundle: true,
      platform,
      target,
      format,
      minify: false,
      sourcemap: true,
      treeShaking: true,
      external: platform === "node" ? ["@agent-type"] : [],
    });
    builtCount++;
  } catch (err) {
    console.error(`  ✗  plugin-manager: failed to build ${src}:`, err.message);
    process.exit(1);
  }
}

// ── Backend entry (copy as .cjs) ─────────────────────────────────────────────
//
// The backend entry is plain JavaScript (no TypeScript compilation needed).
// We copy it to the output directory as backend.cjs so the scanner can
// require() it as CommonJS.

const backendSrc = resolve(SRC_DIR, "backend", "index.js");
const backendOut = resolve(OUT_DIR, "backend.cjs");

if (existsSync(backendSrc)) {
  console.log(`  ┊  plugin-manager: backend/index.js → backend.cjs (copy)`);
  // Ensure output directory exists
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }
  copyFileSync(backendSrc, backendOut);
  builtCount++;
} else {
  console.log(`  ℹ  plugin-manager: no backend entry (backend/index.js) — skipping backend.`);
}

// ── UI build (Vite) ───────────────────────────────────────────────────────────
//
// Compiles the plugin-manager plugin's UI entry (ui/index.html + main.tsx)
// into self-contained HTML + JS + CSS output under ${OUT_DIR}/ui/.
// The host loads this via an iframe sandbox (see uiLoader.ts).

const uiEntry = resolve(SRC_DIR, "ui", "index.html");

if (existsSync(uiEntry)) {
  console.log(`  ┊  plugin-manager: building UI (Vite)…`);
  try {
    execSync("npx vite build --config vite.ui.config.ts", {
      cwd: SRC_DIR,
      stdio: "inherit",
      env: { ...process.env, PLUGIN_OUT_DIR: OUT_DIR },
    });
    console.log(`  ┊  → ${join(OUT_DIR, "ui", "index.html")}`);
  } catch (err) {
    console.error(`  ✖  plugin-manager: UI build failed: ${err.message}`);
    process.exitCode = 1;
  }
} else {
  console.log(`  ℹ  plugin-manager: no UI entry (ui/index.html) — skipping UI build.`);
}

if (builtCount > 0) {
  console.log(`  ✓  plugin-manager: ${builtCount} entry(s) compiled → ${OUT_DIR}`);
}
