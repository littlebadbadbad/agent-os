#!/usr/bin/env node
/**
 * extensions/file/scripts/build.mjs  —  File plugin build script
 *
 * Compiles agent entry (esbuild) + UI entry (Vite).
 */

import esbuild from 'esbuild';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..');
const OUT_DIR = process.env.PLUGIN_OUT_DIR ?? resolve(SRC_DIR, '..', '..', 'plugins', 'file');

// ── Agent entry (esbuild) ──────────────────────────────────────────────────────

const ENTRIES = [
  { src: 'agent/activate.ts', out: 'activate.js', platform: 'browser', target: 'es2022', format: 'esm' },
  { src: 'backend/index.js',  out: 'backend.cjs', platform: 'node',    target: 'node26', format: 'cjs' },
];

let builtCount = 0;

for (const { src, out, platform, target, format } of ENTRIES) {
  const entryFile = resolve(SRC_DIR, src);
  if (!existsSync(entryFile)) {
    console.log(`  \u2139  file: source not found \u2014 ${src}`);
    continue;
  }

  console.log(`  \u2502  file: ${src} \u2192 ${out} (${platform})`);

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
    console.error(`  \u2716  file: failed to compile ${src}: ${err.message}`);
    process.exitCode = 1;
  }
}

if (builtCount === 0) {
  console.log(`  \u2139  file: no source entries found \u2014 nothing compiled.`);
} else {
  console.log(`  \u2714  file: ${builtCount} entry(s) compiled \u2192 ${OUT_DIR}`);
}

// ── UI build (Vite) ───────────────────────────────────────────────────────────

const uiEntry = resolve(SRC_DIR, 'ui', 'index.html');

if (existsSync(uiEntry)) {
  console.log(`  \u2502  file: building UI (Vite)\u2026`);
  try {
    execSync('npx vite build --config vite.ui.config.ts', {
      cwd: SRC_DIR,
      stdio: 'inherit',
      env: { ...process.env, PLUGIN_OUT_DIR: OUT_DIR },
    });
    console.log(`  \u2502  \u2192 ${join(OUT_DIR, 'ui', 'index.html')}`);
  } catch (err) {
    console.error(`  \u2716  file: UI build failed: ${err.message}`);
    process.exitCode = 1;
  }
} else {
  console.log(`  \u2139  file: no UI entry (ui/index.html) \u2014 skipping UI build.`);
}
