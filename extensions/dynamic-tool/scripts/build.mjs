#!/usr/bin/env node
/**
 * extensions/dynamic-tool/scripts/build.mjs  —  Dynamic tool plugin build script
 */

import esbuild from 'esbuild';
import { copyFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..');
const OUT_DIR = process.env.PLUGIN_OUT_DIR ?? resolve(SRC_DIR, '..', '..', 'plugins', 'dynamic-tool');

const ENTRIES = [
  { src: 'agent/activate.ts', out: 'activate.js', platform: 'browser', target: 'es2022', format: 'esm' },
  { src: 'backend/index.js',  out: 'backend.cjs', platform: 'node',    target: 'node26', format: 'cjs' },
];

let builtCount = 0;

for (const { src, out, platform, target, format } of ENTRIES) {
  const entryFile = resolve(SRC_DIR, src);
  if (!existsSync(entryFile)) {
    console.log(`  \u2139  dynamic-tool: source not found \u2014 ${src}`);
    continue;
  }

  console.log(`  \u2502  dynamic-tool: ${src} \u2192 ${out} (${platform})`);

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
    console.error(`  \u2716  dynamic-tool: failed to compile ${src}: ${err.message}`);
    process.exitCode = 1;
  }
}

if (builtCount === 0) {
  console.log(`  \u2139  dynamic-tool: no source entries found \u2014 nothing compiled.`);
} else {
  console.log(`  \u2714  dynamic-tool: ${builtCount} entry(s) compiled \u2192 ${OUT_DIR}`);
}

// ── Copy native bindings ─────────────────────────────────────────────────
// better-sqlite3's .node binary cannot be bundled by esbuild, so we copy
// it alongside the compiled backend. At runtime, the plugin finds it via
// __dirname (which points to OUT_DIR in the compiled CJS bundle).
const BINDING_RELPATH = join('better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const bindingCandidates = [
  join(SRC_DIR, 'node_modules', BINDING_RELPATH),
  join(SRC_DIR, '..', '..', 'node_modules', BINDING_RELPATH),
];
// pnpm: .pnpm/better-sqlite3@{version}/node_modules/better-sqlite3/...
const pnpmDir = join(SRC_DIR, '..', '..', 'node_modules', '.pnpm');
if (existsSync(pnpmDir)) {
  for (const entry of readdirSync(pnpmDir)) {
    if (entry.startsWith('better-sqlite3@')) {
      bindingCandidates.push(
        join(pnpmDir, entry, 'node_modules', BINDING_RELPATH),
      );
      break;
    }
  }
}
const bindingSrc = bindingCandidates.find(existsSync);
if (bindingSrc) {
  copyFileSync(bindingSrc, join(OUT_DIR, 'better_sqlite3.node'));
  console.log(`  \u2502  \u2192 ${join(OUT_DIR, 'better_sqlite3.node')}`);
} else {
  console.warn(`  \u26A0  dynamic-tool: better_sqlite3.node not found \u2014 plugin may fail at runtime`);
}

const uiEntry = resolve(SRC_DIR, 'ui', 'index.html');

if (existsSync(uiEntry)) {
  console.log(`  \u2502  dynamic-tool: building UI (Vite)\u2026`);
  try {
    execSync('npx vite build --config vite.ui.config.ts', {
      cwd: SRC_DIR,
      stdio: 'inherit',
      env: { ...process.env, PLUGIN_OUT_DIR: OUT_DIR },
    });
    console.log(`  \u2502  \u2192 ${join(OUT_DIR, 'ui', 'index.html')}`);
  } catch (err) {
    console.error(`  \u2716  dynamic-tool: UI build failed: ${err.message}`);
    process.exitCode = 1;
  }
} else {
  console.log(`  \u2139  dynamic-tool: no UI entry \u2014 skipping UI build.`);
}
