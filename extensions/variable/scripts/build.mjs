#!/usr/bin/env node
import esbuild from "esbuild";
import { existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, "..");
const OUT_DIR = process.env.PLUGIN_OUT_DIR ?? resolve(SRC_DIR, "..", "..", "plugins", "variable");

const ENTRIES = [
  { src: "agent/activate.ts", out: "activate.js", platform: "browser", target: "es2022", format: "esm" },
];

let builtCount = 0;
for (const { src, out, platform, target, format } of ENTRIES) {
  const entryFile = resolve(SRC_DIR, src);
  if (!existsSync(entryFile)) {
    console.log(`  ℹ  variable: source not found — ${src}`);
    continue;
  }
  console.log(`  ┊  variable: ${src} → ${out} (${platform})`);
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
    });
    builtCount++;
  } catch (err) {
    console.error(`  ✗  variable: failed to build ${src}:`, err.message);
    process.exit(1);
  }
}
if (builtCount > 0) {
  console.log(`  ✓  variable: ${builtCount} entry(s) compiled → ${OUT_DIR}`);
}
