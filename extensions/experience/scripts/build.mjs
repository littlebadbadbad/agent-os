#!/usr/bin/env node
import esbuild from "esbuild";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { copyPluginAssets } from "../../../scripts/plugin-build-utils.mjs";
const SRC_DIR = resolve(__dirname, "..");
const OUT_DIR =
  process.env.PLUGIN_OUT_DIR ??
  resolve(SRC_DIR, "..", "..", "plugins", "experience");

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
    console.log(`  ℹ  experience: source not found — ${src}`);
    continue;
  }
  console.log(`  ┊  experience: ${src} → ${out} (${platform})`);
  try {
    await esbuild.build({
      entryPoints: [entryFile],
      outfile: resolve(OUT_DIR, out),
      platform,
      target,
      format,
      bundle: true,
      external: platform === "node" ? ["@agent-type"] : [],
      sourcemap: false,
    });
    builtCount++;
  } catch (err) {
    console.error(`  ✗  experience: ${src} build failed:`, err);
    process.exitCode = 1;
  }
}

// ── Vite UI build ─────────────────────────────────────────────────────────

const viteConfig = resolve(SRC_DIR, "vite.ui.config.ts");
if (existsSync(viteConfig)) {
  console.log(`  ┊  experience: building UI via Vite…`);
  try {
    execSync(`npx vite build --config "${viteConfig}"`, {
      cwd: SRC_DIR,
      stdio: "inherit",
    });
    builtCount++;
  } catch (err) {
    console.error(`  ✗  experience: UI build failed:`, err);
    process.exitCode = 1;
  }
}

if (builtCount > 0) {
  console.log(`  ✔  experience: done (${builtCount} builds)`);
  copyPluginAssets(SRC_DIR, OUT_DIR);
}
