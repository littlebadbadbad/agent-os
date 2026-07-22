#!/usr/bin/env node
import esbuild from "esbuild";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { copyPluginAssets } from "../../../scripts/plugin-build-utils.mjs";
const SRC_DIR = resolve(__dirname, "..");
const OUT_DIR = process.env.PLUGIN_OUT_DIR ?? resolve(SRC_DIR, "..", "..", "plugins", "tool-state");

const ENTRIES = [
  { src: "agent/activate.ts", out: "activate.js", platform: "browser", target: "es2022", format: "esm" },
];

let builtCount = 0;
for (const { src, out, platform, target, format } of ENTRIES) {
  const entryFile = resolve(SRC_DIR, src);
  if (!existsSync(entryFile)) { console.log(`  ℹ  tool-state: source not found — ${src}`); continue; }
  console.log(`  ┊  tool-state: ${src} → ${out} (${platform})`);
  try {
    await esbuild.build({ entryPoints: [entryFile], outfile: resolve(OUT_DIR, out), bundle: true, platform, target, format, minify: false, sourcemap: true, treeShaking: true, external: platform === "node" ? ["@agent-type"] : [] });
    builtCount++;
  } catch (err) { console.error(`  ✗  tool-state: failed to build ${src}:`, err.message); process.exit(1); }
}
if (builtCount > 0) console.log(`  ✓  tool-state: ${builtCount} entry(s) compiled → ${OUT_DIR}`);

const uiEntry = resolve(SRC_DIR, 'ui', 'index.html');
if (existsSync(uiEntry)) {
  console.log(`  ┊  tool-state: building UI (Vite)…`);
  try { execSync('npx vite build --config vite.ui.config.ts', { cwd: SRC_DIR, stdio: 'inherit', env: { ...process.env, PLUGIN_OUT_DIR: OUT_DIR } }); }
  catch (err) { console.error(`  ✖  tool-state: UI build failed: ${err.message}`); process.exitCode = 1; }
}
copyPluginAssets(SRC_DIR, OUT_DIR);
