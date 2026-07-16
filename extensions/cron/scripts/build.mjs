#!/usr/bin/env node
/**
 * extensions/cron/scripts/build.mjs  —  Cron plugin build script.
 *
 * Compiles the cron plugin's agent and backend entries into the
 * plugin output directory (PLUGIN_OUT_DIR or default ../../plugins/cron).
 *
 * Each entry is compiled with the correct platform:
 *   - agent entry → platform: 'browser' (runs in browser sandbox)
 *   - backend entry → platform: 'node' (runs on Node.js server)
 *
 * Usage (from extensions/cron/):
 *   node scripts/build.mjs
 *
 * Or via the orchestrator:
 *   node scripts/compile-plugins.mjs
 */

import esbuild from 'esbuild';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Paths ─────────────────────────────────────────────────────────────────────

/** Plugin source root: extensions/cron/ */
const SRC_DIR = resolve(__dirname, '..');

/** Output directory: from env var (set by compile-plugins.mjs), or default. */
const OUT_DIR = process.env.PLUGIN_OUT_DIR ?? resolve(SRC_DIR, '..', '..', 'plugins', 'cron');

// ── Source-to-output mapping ─────────────────────────────────────────────────

const ENTRIES = [
  { src: 'agent/activate.ts',    out: 'activate.js', platform: 'browser', target: 'es2022', format: 'esm' },
  { src: 'backend/index.js',     out: 'backend.cjs', platform: 'node',    target: 'node26', format: 'cjs' },
];

// ── Build ─────────────────────────────────────────────────────────────────────

let builtCount = 0;

for (const { src, out, platform, target, format } of ENTRIES) {
  const entryFile = resolve(SRC_DIR, src);

  if (!existsSync(entryFile)) {
    console.log(`  ℹ  cron: source not found — ${src}`);
    continue;
  }

  console.log(`  ┊  cron: ${src} → ${out} (${platform})`);

  const buildPlugins = [];

  if (platform === 'node') {
    buildPlugins.push({
      name: 'externalize-outside-source',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return undefined;

          const resolved = resolve(dirname(args.importer), args.path);

          if (resolved.startsWith(SRC_DIR)) return undefined;

          if (args.path.startsWith('node:') || args.path === 'module' || args.path === 'path') {
            return { external: true };
          }

          return { external: true };
        });
      },
    });
  }

  try {
    await esbuild.build({
      entryPoints: [entryFile],
      outfile: join(OUT_DIR, out),
      platform,
      target,
      format,
      bundle: true,
      sourcemap: true,
      plugins: buildPlugins,
    });
    builtCount++;
  } catch (err) {
    console.error(`  ✖  cron: ${src} build failed:`, err.message);
    process.exitCode = 1;
  }
}

if (builtCount > 0) {
  console.log(`  ✔  cron: compiled ${builtCount} entry/entries`);
}

// ── Vite build for UI ─────────────────────────────────────────────────────────
// Build the UI entry (iframe sandbox) using Vite.

const uiEntry = resolve(SRC_DIR, 'ui', 'index.html');
if (existsSync(uiEntry)) {
  console.log(`  ┊  cron: building UI (Vite)…`);

  const uiOutDir = join(OUT_DIR, 'ui');
  const viteConfigPath = resolve(SRC_DIR, 'vite.ui.config.ts');

  try {
    execSync(`npx vite build --config "${viteConfigPath}"`, {
      cwd: SRC_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        PLUGIN_UI_OUT_DIR: uiOutDir,
      },
    });
    console.log(`  ✔  cron: UI build complete`);
  } catch (err) {
    console.error(`  ✖  cron: UI build failed:`, err.message);
    process.exitCode = 1;
  }
}
