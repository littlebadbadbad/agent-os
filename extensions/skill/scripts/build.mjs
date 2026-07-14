#!/usr/bin/env node
/**
 * extensions/skill/scripts/build.mjs  —  Skill plugin build script.
 *
 * Compiles the skill plugin's agent and backend entries into the
 * plugin output directory (PLUGIN_OUT_DIR or default ../../plugins/skill).
 *
 * Each entry is compiled with the correct platform:
 *   - agent entry → platform: 'browser' (runs in browser sandbox)
 *   - backend entry → platform: 'node' (runs on Node.js server)
 *
 * The source-to-output mapping is defined in SOURCE_MAP below — each entry
 * declares its source file (relative to the plugin source directory) and
 * its output filename (relative to PLUGIN_OUT_DIR). The manifest declares
 * the runtime-visible output paths; this script compiles the sources to
 * match those paths.
 *
 * Backend entry imports that resolve outside the plugin source directory
 * are externalized — they'll be resolved at runtime by Node.js via
 * relative require paths back into the main backend.
 *
 * Usage (from extensions/skill/):
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

/** Plugin source root: extensions/skill/ */
const SRC_DIR = resolve(__dirname, '..');

/** Output directory: from env var (set by compile-plugins.mjs), or default. */
const OUT_DIR = process.env.PLUGIN_OUT_DIR ?? resolve(SRC_DIR, '..', '..', 'plugins', 'skill');

// ── Source-to-output mapping ─────────────────────────────────────────────────
// Each entry: { src, out, platform, target }
//   src  — source file relative to SRC_DIR
//   out  — output filename relative to OUT_DIR (must match manifest declarations)
//   platform — esbuild platform ('browser' | 'node')
//   target   — esbuild target ('es2022' | 'node26')

const ENTRIES = [
  { src: 'agent/activate.ts',    out: 'activate.js', platform: 'browser', target: 'es2022', format: 'esm' },
  { src: 'backend/index.js',     out: 'backend.cjs', platform: 'node',    target: 'node26', format: 'cjs' },
];

// ── Build ─────────────────────────────────────────────────────────────────────

let builtCount = 0;

for (const { src, out, platform, target, format } of ENTRIES) {
  const entryFile = resolve(SRC_DIR, src);

  if (!existsSync(entryFile)) {
    console.log(`  ℹ  skill: source not found — ${src}`);
    continue;
  }

  console.log(`  ┊  skill: ${src} → ${out} (${platform})`);

  // Plugin for esbuild to handle backend imports correctly.
  const buildPlugins = [];

  if (platform === 'node') {
    buildPlugins.push({
      name: 'externalize-outside-source',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return undefined;

          const resolved = resolve(dirname(args.importer), args.path);

          if (resolved.startsWith(SRC_DIR)) return undefined;

          // Externalize node built-ins.
          if (args.path.startsWith('node:') || args.path === 'module' || args.path === 'path') {
            return { external: true };
          }

          // Externalize everything else — resolved at runtime by Node.js module
          // resolution (walks up directories).
          return { external: true };
        });
      },
    });
  }

  try {
    await esbuild.build({
      entryPoints: [entryFile],
      outfile:     join(OUT_DIR, out),
      bundle:      true,
      platform,
      target,
      format,
      external:    platform === 'node'
        ? ['@agent-type', '@agent-sdk', 'adm-zip']
        : ['@agent-sdk'],
      plugins:     buildPlugins,
      logLevel:    'warning',
      logOverride: {
        'require-resolve-not-external': 'silent',
      },
    });
    builtCount++;
  } catch (err) {
    console.error(`  ✖  skill: ${src} failed —`, err.message || err);
    process.exitCode = 1;
  }
}

// ── Vite UI build ─────────────────────────────────────────────────────────────

try {
  console.log(`  ┊  skill: building UI via Vite...`);
  execSync('npx vite build --config vite.ui.config.ts', {
    cwd: SRC_DIR,
    stdio: 'inherit',
    env: { ...process.env, PLUGIN_OUT_DIR: OUT_DIR },
  });
  console.log(`  ✔  skill: UI built`);
  builtCount++;
} catch {
  console.error(`  ✖  skill: UI build failed`);
  process.exitCode = 1;
}

// ── Summary ───────────────────────────────────────────────────────────────────

const totalExpected = ENTRIES.length + 1; // entries + UI
if (builtCount === totalExpected) {
  console.log(`  ✔  skill: all ${builtCount} build(s) succeeded`);
} else {
  console.log(`  ⚠  skill: ${builtCount}/${totalExpected} build(s) succeeded`);
}
