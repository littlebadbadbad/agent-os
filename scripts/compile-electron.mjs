#!/usr/bin/env node
/**
 * scripts/compile-electron.mjs  —  Compile Electron TypeScript entry points.
 *
 * Outputs
 * ───────
 *   dist-electron/main.mjs     ESM bundle for the Electron main process
 *   dist-electron/preload.cjs  CJS bundle for the Electron preload script
 *
 * Both bundles are compiled with esbuild (no separate tsc pass needed).
 * "electron" is external because it is provided by the Electron runtime.
 * "server.cjs" is external because it is loaded at runtime via require().
 * "../backend/index.js" is external so dev-mode dynamic import() is preserved
 *   as a real file-system import that Node.js resolves at runtime.
 */

import esbuild from 'esbuild';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const OUT_DIR   = resolve(ROOT, 'dist-electron');

mkdirSync(OUT_DIR, { recursive: true });

const sharedOptions = {
  bundle:   true,
  platform: 'node',
  target:   'node26',
  external: ['electron'],
  logLevel: 'info',
};

await Promise.all([
  // ── Main process (ESM) ────────────────────────────────────────────────────
  esbuild.build({
    ...sharedOptions,
    entryPoints: [resolve(ROOT, 'electron', 'main.ts')],
    outfile:     resolve(OUT_DIR, 'main.mjs'),
    format:      'esm',
    // server.cjs is bundled by gui-build.mjs; ../backend/index.js is the ESM
    // source loaded via dynamic import() in dev mode.
    external:    [...sharedOptions.external, './server.cjs', '../backend/index.js'],
  }),

  // ── Preload script (CJS, required by Electron) ────────────────────────────
  esbuild.build({
    ...sharedOptions,
    entryPoints: [resolve(ROOT, 'electron', 'preload.ts')],
    outfile:     resolve(OUT_DIR, 'preload.cjs'),
    format:      'cjs',
  }),
]);

console.log('Electron scripts compiled → dist-electron/');
