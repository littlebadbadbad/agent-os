#!/usr/bin/env node
/**
 * extensions/user-input/scripts/build.mjs  —  User Input plugin build script.
 *
 * Compiles the user-input plugin's agent entry and UI entry into the
 * plugin output directory (PLUGIN_OUT_DIR or default ../../plugins/user-input).
 *
 * Entries:
 *   agent/activate.ts  → activate.js       (esbuild, browser sandbox, es2022, esm)
 *   ui/index.html      → ui/index.html     (Vite, self-contained HTML+JS+CSS)
 *
 * Usage (from extensions/user-input/):
 *   node scripts/build.mjs
 *
 * Or via the orchestrator:
 *   node scripts/compile-plugins.mjs
 */

import esbuild from "esbuild";
import { existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Plugin source root: extensions/user-input/ */
const SRC_DIR = resolve(__dirname, "..");

/** Output directory: from env var (set by compile-plugins.mjs), or default. */
const OUT_DIR =
  process.env.PLUGIN_OUT_DIR ??
  resolve(SRC_DIR, "..", "..", "plugins", "user-input");

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
    console.log(`  ℹ  user-input: source not found — ${src}`);
    continue;
  }

  console.log(`  ┊  user-input: ${src} → ${out} (${platform})`);

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
    console.error(`  ✗  user-input: failed to build ${src}:`, err.message);
    process.exit(1);
  }
}

if (builtCount > 0) {
  console.log(`  ✓  user-input: ${builtCount} entry(s) compiled → ${OUT_DIR}`);
}

// ── UI build (Vite) ───────────────────────────────────────────────────────────
//
// Compiles the user-input plugin's UI entry (ui/index.html + main.tsx) into
// self-contained HTML + JS + CSS output under ${OUT_DIR}/ui/.
// The host loads this via an iframe sandbox.

const uiEntry = resolve(SRC_DIR, "ui", "index.html");

if (existsSync(uiEntry)) {
  console.log(`  ┊  user-input: building UI (Vite)…`);
  try {
    execSync("npx vite build --config vite.ui.config.ts", {
      cwd: SRC_DIR,
      stdio: "inherit",
      env: { ...process.env, PLUGIN_OUT_DIR: OUT_DIR },
    });
    console.log(`  ┊  → ${join(OUT_DIR, "ui", "index.html")}`);
  } catch (err) {
    console.error(`  ✖  user-input: UI build failed: ${err.message}`);
    process.exitCode = 1;
  }
} else {
  console.log(
    `  ℹ  user-input: no UI entry (ui/index.html) — skipping UI build.`,
  );
}
