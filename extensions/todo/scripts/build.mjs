#!/usr/bin/env node
/**
 * extensions/todo/scripts/build.mjs  —  Todo plugin build script.
 *
 * Compiles the todo plugin's agent entry and UI entry into the
 * plugin output directory (PLUGIN_OUT_DIR or default ../../plugins/todo).
 *
 * Entries:
 *   agent/activate.ts  → activate.js       (esbuild, browser sandbox, es2022, esm)
 *   ui/index.html      → ui/index.html     (Vite, self-contained HTML+JS+CSS)
 *
 * Usage (from extensions/todo/):
 *   node scripts/build.mjs
 *
 * Or via the orchestrator:
 *   node scripts/compile-plugins.mjs
 */

import esbuild from "esbuild";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Plugin source root: extensions/todo/ */
const SRC_DIR = resolve(__dirname, "..");

/** Output directory: from env var (set by compile-plugins.mjs), or default. */
const OUT_DIR =
  process.env.PLUGIN_OUT_DIR ??
  resolve(SRC_DIR, "..", "..", "plugins", "todo");

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
    console.log(`  ℹ  todo: source not found — ${src}`);
    continue;
  }

  console.log(`  ┊  todo: ${src} → ${out} (${platform})`);

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
    console.error(`  ✗  todo: failed to build ${src}:`, err.message);
    process.exit(1);
  }
}

// ── UI build (Vite) ───────────────────────────────────────────────────────────
//
// Compiles the todo plugin's UI entry (ui/index.html + main.tsx) into
// self-contained HTML + JS + CSS output under ${OUT_DIR}/ui/.
// The host loads this via an iframe sandbox (see uiLoader.ts).

const uiEntry = resolve(SRC_DIR, 'ui', 'index.html');

if (existsSync(uiEntry)) {
  console.log(`  ┊  todo: building UI (Vite)…`);
  try {
    execSync('npx vite build --config vite.ui.config.ts', {
      cwd: SRC_DIR,
      stdio: 'inherit',
      env: { ...process.env, PLUGIN_OUT_DIR: OUT_DIR },
    });
    console.log(`  ┊  → ${join(OUT_DIR, 'ui', 'index.html')}`);
  } catch (err) {
    console.error(`  ✖  todo: UI build failed: ${err.message}`);
    process.exitCode = 1;
  }
} else {
  console.log(`  ℹ  todo: no UI entry (ui/index.html) — skipping UI build.`);
}

if (builtCount > 0) {
  console.log(`  ✓  todo: ${builtCount} entry(s) compiled → ${OUT_DIR}`);
}
