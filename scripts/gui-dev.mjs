#!/usr/bin/env node
/**
 * scripts/gui-dev.mjs  —  Start Electron in GUI development mode
 *
 * Orchestrates a two-way concurrent process:
 *   1. Vite dev server (frontend with HMR, proxying /api to backend)
 *   2. Electron window, which loads the backend source directly via
 *      dynamic import() (no pre-bundling step needed)
 *
 * Usage
 * ─────
 *   node scripts/gui-dev.mjs
 *   pnpm run gui:dev
 *
 * The script compiles Electron entry points (main + preload) FIRST, then
 * starts Vite + Electron concurrently.  The backend is loaded by Electron
 * itself from source at runtime — no esbuild bundling of backend/index.js.
 *
 * Environment overrides
 * ─────────────────────
 *   VITE_PORT          Port for the Vite dev server  (default: 5173)
 *   VITE_DEV_SERVER    Full URL override              (default: http://localhost:<VITE_PORT>)
 *   PORT               Backend server port            (default: 3001, from .env: 3002)
 */

import { execSync, spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const VITE_PORT = parseInt(process.env.VITE_PORT ?? '5173', 10);
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? `http://localhost:${VITE_PORT}`;

// Electron binary mirror — pnpm does NOT pass npmrc's electron_mirror to
// child processes, so @electron/get can't find the binary from China.
// See .npmrc for the canonical values.
const ELECTRON_MIRROR = 'https://repo.huaweicloud.com/electron/';
const ELECTRON_CACHE_DIR = resolve(ROOT, '.electron-cache');

// ── Child process tracking ─────────────────────────────────────────────────────
let viteProcess = null;
let electronProcess = null;

function cleanup() {
  if (viteProcess) {
    try { viteProcess.kill(); } catch {}
    viteProcess = null;
  }
  if (electronProcess) {
    try { electronProcess.kill(); } catch {}
    electronProcess = null;
  }
}

// ── Global exit guards ────────────────────────────────────────────────────────
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd) {
  console.log(`\n▶  ${cmd}`);
  execSync(cmd, { stdio: 'inherit', shell: true, cwd: ROOT });
}

async function main() {
  // ── Step 1: Compile Electron TypeScript entry points ─────────────────────
  console.log('\n=== Step 1: Compile Electron entry points ===');
  run('node scripts/compile-electron.mjs');

  // ── Step 1.5: Compile plugins ────────────────────────────────────────────
  // Ensures plugin artifacts in plugins/ are up-to-date before backend boots.
  console.log('\n=== Step 1.5: Compile plugins ===');
  run('node scripts/compile-plugins.mjs');

  // ── Step 2: Start Vite dev server ────────────────────────────────────────
  // (Backend is loaded by Electron itself from source — no bundling needed.)
  console.log('\n=== Step 2: Start Vite dev server ===');
  viteProcess = spawn(
    'vite',
    ['--config', 'vite.demo.config.ts', '--port', String(VITE_PORT)],
    { stdio: 'inherit', shell: true, cwd: ROOT },
  );

  // Give Vite a moment to bind the port, then start Electron
  await new Promise((r) => setTimeout(r, 2000));

  // ── Step 3: Start Electron ───────────────────────────────────────────────
  // Electron's main.ts (compiled → dist-electron/main.mjs) loads the backend
  // source via dynamic import('../backend/index.js') in dev mode, so no
  // separate server.cjs is needed.
  console.log(`\n=== Step 3: Start Electron (frontend → ${VITE_DEV_SERVER_URL}) ===`);
  electronProcess = spawn(
    'electron',
    ['dist-electron/main.mjs'],
    {
      stdio: 'inherit',
      shell: true,
      cwd: ROOT,
      env: { ...process.env, VITE_DEV_SERVER_URL, ELECTRON_MIRROR, electron_config_cache: ELECTRON_CACHE_DIR },
    },
  );

  // ── Exit propagation ────────────────────────────────────────────────────
  electronProcess.on('exit', (code) => {
    console.log(`\nElectron exited (code ${code}). Shutting down…`);
    cleanup();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[gui-dev] Fatal error:', err);
  cleanup();
  process.exit(1);
});
