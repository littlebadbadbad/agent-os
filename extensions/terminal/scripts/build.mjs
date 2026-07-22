#!/usr/bin/env node
/**
 * extensions/terminal/scripts/build.mjs  —  Terminal plugin build script.
 *
 * Compiles the terminal plugin's agent and backend entries into the
 * plugin output directory (PLUGIN_OUT_DIR or default ../../plugins/terminal).
 *
 * Entries:
 *   agent/activate.ts   → activate.js      (esbuild, browser sandbox, es2022, esm)
 *   backend/index.js    → backend.cjs      (esbuild, node, node26, cjs)
 *   ui/index.html       → ui/index.html    (Vite, self-contained HTML+JS+CSS)
 *
 * Backend build externalises `node-pty` (native addon — cannot be bundled).
 * All other dependencies are bundled into a self-contained backend.cjs.
 */

import esbuild from "esbuild";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { copyPluginAssets } from "../../../scripts/plugin-build-utils.mjs";
const SRC_DIR = resolve(__dirname, "..");
const OUT_DIR = process.env.PLUGIN_OUT_DIR ?? resolve(SRC_DIR, "..", "..", "plugins", "terminal");

const ENTRIES = [
  // Agent entry: runs in browser sandbox — platform: browser.
  {
    src: "agent/activate.ts",
    out: "activate.js",
    platform: "browser",
    target: "es2022",
    format: "esm",
  },
  // Backend entry: runs in Node.js — platform: node.
  // All dependencies bundled except native addons (node-pty).
  {
    src: "backend/index.js",
    out: "backend.cjs",
    platform: "node",
    target: "node26",
    format: "cjs",
  },
];

let builtCount = 0;
for (const { src, out, platform, target, format } of ENTRIES) {
  const entryFile = resolve(SRC_DIR, src);
  if (!existsSync(entryFile)) {
    console.log(`  ℹ  terminal: source not found — ${src}`);
    continue;
  }
  console.log(`  ┊  terminal: ${src} → ${out} (${platform})`);

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
      // node-pty is a native C++ addon — cannot be bundled.
      external: platform === "node" ? ["@agent-type", "node-pty"] : [],
    });
    builtCount++;
  } catch (err) {
    console.error(`  ✗  terminal: failed to build ${src}:`, err.message);
    process.exit(1);
  }
}
if (builtCount > 0) {
  console.log(`  ✓  terminal: ${builtCount} entry(s) compiled → ${OUT_DIR}`);
}

const uiEntry = resolve(SRC_DIR, 'ui', 'index.html');
if (existsSync(uiEntry)) {
  console.log(`  ┊  terminal: building UI (Vite)…`);
  try {
    execSync('npx vite build --config vite.ui.config.ts', {
      cwd: SRC_DIR,
      stdio: 'inherit',
      env: { ...process.env, PLUGIN_OUT_DIR: OUT_DIR },
    });
    console.log(`  ┊  → ${join(OUT_DIR, 'ui', 'index.html')}`);
  } catch (err) {
    console.error(`  ✖  terminal: UI build failed: ${err.message}`);
    process.exitCode = 1;
  }
} else {
  console.log(`  ℹ  terminal: no UI entry (ui/index.html) — skipping UI build.`);
}
copyPluginAssets(SRC_DIR, OUT_DIR);
