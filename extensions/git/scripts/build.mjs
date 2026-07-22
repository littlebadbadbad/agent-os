#!/usr/bin/env node
/**
 * extensions/git/scripts/build.mjs  —  Git plugin build script
 *
 * Compiles agent entry (esbuild) + backend entry (esbuild).
 */

import esbuild from 'esbuild';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { copyPluginAssets } from "../../../scripts/plugin-build-utils.mjs";
const SRC_DIR = resolve(__dirname, '..');
const OUT_DIR = process.env.PLUGIN_OUT_DIR ?? resolve(SRC_DIR, '..', '..', 'plugins', 'git');

// ── Agent entry (esbuild) ──────────────────────────────────────────────────────

const ENTRIES = [
  { src: 'agent/activate.ts', out: 'activate.js', platform: 'browser', target: 'es2022', format: 'esm' },
  { src: 'backend/index.js',  out: 'backend.cjs', platform: 'node',    target: 'node26', format: 'cjs' },
];

let builtCount = 0;

for (const { src, out, platform, target, format } of ENTRIES) {
  const entryFile = resolve(SRC_DIR, src);
  if (!existsSync(entryFile)) {
    console.log(`  \u2139  git: source not found \u2014 ${src}`);
    continue;
  }

  console.log(`  \u2502  git: ${src} \u2192 ${out} (${platform})`);

  try {
    await esbuild.build({
      entryPoints: [entryFile],
      outfile:     join(OUT_DIR, out),
      bundle:      true,
      platform,
      target,
      format,
      external:    platform === 'node'
        ? ['@agent-type', '@agent-sdk']
        : ['@agent-sdk'],
      logLevel: 'warning',
    });
    builtCount++;
    console.log(`  \u2502  \u2192 ${join(OUT_DIR, out)}`);
  } catch (err) {
    console.error(`  \u2717  git: failed to build ${src}:`, err.message);
    process.exitCode = 1;
  }
}

if (builtCount > 0) {
  console.log(`  \u2713  git: ${builtCount} entry(s) compiled \u2192 ${OUT_DIR}`);
  copyPluginAssets(SRC_DIR, OUT_DIR);
}