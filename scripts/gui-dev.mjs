#!/usr/bin/env node
/**
 * scripts/gui-dev.mjs  —  Start Electron in GUI development mode
 *
 * Orchestrates a two-way concurrent process:
 *   1. Interactive plugin selection (new! — space to toggle, arrow keys to move)
 *   2. Vite dev server (frontend with HMR, proxying /api to backend)
 *   3. Electron window, which loads the backend source directly via
 *      dynamic import() (no pre-bundling step needed)
 *
 * Usage
 * ─────
 *   node scripts/gui-dev.mjs
 *   pnpm run gui:dev
 *
 * Plugin selection supports:
 *   • Space to toggle individual plugins
 *   • Arrow keys (↑/↓) to navigate
 *   • Ctrl+A to select all / Ctrl+R to toggle all
 *   • Type to filter
 *   • Default: none selected (skips plugin compilation)
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
import { selectPlugins } from './plugin-selector.mjs';

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
  // Graceful shutdown: send SIGTERM first so Electron can flush sessions.
  // On Windows, child_process.kill() is forcible (SIGTERM not supported),
  // so we use a small delay to give the app:requestFlush IPC cycle time
  // to complete before the process is killed.
  if (electronProcess) {
    try {
      console.log('[gui-dev] Shutting down — giving Electron 2 s to flush sessions...');
      // Send a custom message to trigger flush before killing.
      const killed = electronProcess.kill('SIGTERM');
      if (!killed) {
        // Windows: SIGTERM may not work; give a grace period then force kill.
        setTimeout(() => {
          try { electronProcess?.kill(); } catch {}
        }, 2000);
      }
    } catch {}
  }
  if (viteProcess) {
    try { viteProcess.kill(); } catch {}
    viteProcess = null;
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

  // ── Step 1.5: Interactive plugin selection + compile ────────────────────
  // Ask the user which plugins to bundle before booting the backend.
  console.log('\n=== Step 1.5: Select plugins to bundle ===');
  const selectedPluginNames = await selectPlugins();

  if (selectedPluginNames.length > 0) {
    process.env.PLUGIN_FILTER = selectedPluginNames.join(',');
    console.log(`\n=== Step 1.5b: Compile selected plugins (${selectedPluginNames.length}) ===`);
    run('node scripts/compile-plugins.mjs');
  } else {
    console.log('  ℹ  No plugins selected — skipping plugin compilation.');
  }

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
