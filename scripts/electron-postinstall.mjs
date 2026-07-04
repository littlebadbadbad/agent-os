#!/usr/bin/env node
/**
 * scripts/electron-postinstall.mjs  —  Ensure Electron binary is installed
 *
 * Two strategies, tried in order:
 *   1. Extract from local cache (`.electron-cache/`) — no network needed
 *   2. Fall back to the official `node_modules/electron/install.js`
 *
 * Hooked up as "postinstall" in package.json — runs automatically after
 * every `pnpm install`.
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Read electron settings from .npmrc ─────────────────────────────────────
const npmrcPath = resolve(ROOT, '.npmrc');
let electronMirror = process.env.ELECTRON_MIRROR;
let electronCache  = process.env.electron_config_cache;

try {
  const npmrc = fs.readFileSync(npmrcPath, 'utf-8');
  const m = npmrc.match(/^electron_mirror\s*=\s*(\S+)/m);
  const c = npmrc.match(/^electron_config_cache\s*=\s*(\S+)/m);
  if (m) electronMirror ??= m[1];
  if (c) electronCache  ??= c[1];
} catch { /* ignore */ }

// ── Locate @electron/get via electron's context ────────────────────────────
const ELECTRON_PKG = resolve(ROOT, 'node_modules', 'electron');
const BIN_NAME = { 'win32-x64':'electron.exe','win32-arm64':'electron.exe',
  'darwin-x64':'Electron.app/Contents/MacOS/Electron',
  'darwin-arm64':'Electron.app/Contents/MacOS/Electron',
  'linux-x64':'electron','linux-arm64':'electron'
}[`${process.env.ELECTRON_INSTALL_PLATFORM||process.platform}-${process.env.ELECTRON_INSTALL_ARCH||process.arch}`];
const DIST_DIR  = resolve(ELECTRON_PKG, 'dist');
const PATH_FILE = resolve(ELECTRON_PKG, 'path.txt');

function isInstalled() {
  return fs.existsSync(PATH_FILE) &&
         fs.readFileSync(PATH_FILE,'utf-8').trim() === BIN_NAME &&
         fs.existsSync(resolve(DIST_DIR, BIN_NAME));
}
if (isInstalled()) process.exit(0);

console.log('📦  Ensuring Electron binary is installed…');

// ── Step 1: Get the zip path (from cache or download) ──────────────────────
let zipPath;
try {
  // Follow symlink to pnpm's real store path so @electron/get resolves correctly
  const require = createRequire(resolve(fs.realpathSync(ELECTRON_PKG), 'index.js'));
  const { downloadArtifact } = require('@electron/get');
  const version = JSON.parse(fs.readFileSync(resolve(ELECTRON_PKG,'package.json'),'utf-8')).version;
  zipPath = await downloadArtifact({
    version, artifactName: 'electron',
    platform: process.platform, arch: process.arch,
    cacheRoot: electronCache,
    ...(electronMirror ? { mirrorOptions: { mirror: electronMirror } } : {}),
  });
} catch (err) {
  // If @electron/get fails, try the underlying install.js as fallback
  console.error('  ⚠  @electron/get failed:', err.message);
  console.log('  → Falling back to node node_modules/electron/install.js…');
  try {
    execSync('node node_modules/electron/install.js', {
      cwd: ROOT, stdio: 'inherit',
      env: { ...process.env,
        ...(electronMirror ? { ELECTRON_MIRROR: electronMirror } : {}),
        ...(electronCache  ? { electron_config_cache: electronCache } : {}) },
      timeout: 5 * 60 * 1000,
    });
    zipPath = null; // install.js extracted directly into dist/
  } catch (e2) {
    throw new Error(`install.js also failed: ${e2.message}`);
  }
}

// ── Step 2: Extract ────────────────────────────────────────────────────────
if (zipPath) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const ps = `${process.env.WINDIR}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  execSync(
    `"${ps}" -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g,"''")}' -DestinationPath '${DIST_DIR.replace(/'/g,"''")}' -Force"`,
    { stdio: 'pipe', timeout: 120000 },
  );
}

// ── Step 3: Write path.txt ─────────────────────────────────────────────────
if (!fs.existsSync(PATH_FILE) && fs.existsSync(resolve(DIST_DIR, BIN_NAME))) {
  fs.writeFileSync(PATH_FILE, BIN_NAME);
}

// ── Verify ─────────────────────────────────────────────────────────────────
if (!isInstalled()) {
  console.error('❌  Electron postinstall failed.');
  console.error('    Expected:', resolve(DIST_DIR, BIN_NAME));
  console.error('    Dist:',
    fs.existsSync(DIST_DIR) ? fs.readdirSync(DIST_DIR).join(', ') : '(empty)');
  process.exit(1);
}

console.log('✅  Electron binary is ready');
