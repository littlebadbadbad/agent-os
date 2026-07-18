#!/usr/bin/env node
/**
 * scripts/gui-build.mjs  —  Build the Electron application for Windows distribution.
 *
 * Release layout (matches cui-build.mjs so the same launcher works for both)
 * ──────────────────────────────────────────────────────────────────────────────
 *   release/
 *     <EXE_NAME>.exe          ← version-selecting launcher  (rebuilt each run)
 *     current-version         ← plain-text name of the active version dir
 *     server-name             ← plain-text server exe stem
 *     .agent/                 ┐
 *     data/                   │ shared mutable data — preserved across versions
 *     workspace/              ┘
 *     <BUILD_VERSION>/        ← e.g. "v0.1.0-20260530-162904"
 *       <EXE_NAME>.exe        ← Electron main exe (renamed from "agent-sdk.exe")
 *       resources/            ← Electron resources (app/, dlls, etc.)
 *         app/
 *           main.mjs          ← Electron main process bundle
 *           preload.cjs       ← Electron preload bundle
 *           server.cjs        ← backend HTTP server bundle
 *           dist-demo/        ← frontend static assets (base: './')
 *           node_modules/     ← native bindings rebuilt for Electron
 *       locales/
 *       *.dll                 ← Electron runtime DLLs
 *       node_modules/playwright/  ← runtime playwright (NOT inside Electron app)
 *
 * Environment overrides
 * ─────────────────────
 *   APP_EXE_NAME      Executable stem, without extension          (default: agent-sdk)
 *   APP_LAUNCHER_NAME Launcher exe stem (overrides APP_EXE_NAME)  (default: APP_EXE_NAME)
 *   APP_SERVER_NAME   Server exe stem   (overrides APP_EXE_NAME)  (default: APP_EXE_NAME)
 *   BUILD_VERSION     Version directory name                      (default: v<pkg.version>-<ts>)
 *   ELECTRON_VERSION  Electron version to rebuild for             (default: 42.3.0)
 *   VCINSTALLDIR      Path to MSVC Visual C++ tools               (for node-gyp on Windows)
 *   GYP_PYTHON        Python interpreter for node-gyp             (default: python)
 *
 * Notes
 * ─────
 * • This script runs electron-rebuild which recompiles better-sqlite3 and
 *   node-pty against the Electron headers.  After this step the .node files
 *   in node_modules/ are Electron-ABI builds, not Node.js builds.  Run
 *   `pnpm rebuild` (or `pnpm install --force`) to restore Node.js builds.
 *
 * • The launcher logic (scripts/launcher.cjs) is NOT modified; it keeps
 *   reading current-version / server-name and spawning the versioned exe.
 *
 * • cui-build.mjs (pkg-based black-box build) remains fully functional as
 *   an alternative build path.
 */

import {
  cpSync, mkdirSync, rmSync, existsSync, renameSync,
  readdirSync, copyFileSync, writeFileSync, readFileSync, realpathSync,
} from 'fs';
import { createHash } from 'crypto';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { run, buildEnv, applyDotEnv, resolveVcInstallDir, resolveGypPython } from './runtime.mjs';
import { packager } from '@electron/packager';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

applyDotEnv();

// ── Configuration ─────────────────────────────────────────────────────────────

const pkgJson   = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const _ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  .replace(/^(\d{8})(\d{6})$/, '$1-$2');
const BUILD_VER      = process.env.BUILD_VERSION    ?? `v${pkgJson.version}-${_ts}`;
const LAUNCHER_NAME  = process.env.APP_LAUNCHER_NAME ?? process.env.APP_EXE_NAME ?? 'agent-sdk';
const SERVER_NAME    = process.env.APP_SERVER_NAME   ?? process.env.APP_EXE_NAME ?? 'agent-sdk';
const ELECTRON_VER   = process.env.ELECTRON_VERSION  ?? '42.3.0';

const DIST_BACKEND    = join(ROOT, 'dist-backend');
const DIST_DEMO       = join(ROOT, 'dist-demo');
const DIST_ELECTRON   = join(ROOT, 'dist-electron');
const DIST_ELECTRON_APP = join(ROOT, 'dist-electron-app');
const RELEASE         = join(ROOT, 'release');
const VER_DIR         = join(RELEASE, BUILD_VER);

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(d) { mkdirSync(d, { recursive: true }); }

function pkgRun(cmd) {
  const env = buildEnv();
  if (env.PKG_CACHE_PATH) env.PKG_CACHE_PATH = resolve(env.PKG_CACHE_PATH);
  run(cmd, { env });
}

/** Locate a package inside pnpm's content-addressed store or hoisted node_modules. */
function findPkg(name) {
  const lastName = name.includes('/') ? name.split('/').pop() : name;
  const direct = join(ROOT, 'node_modules', name);
  if (existsSync(direct)) {
    try { return realpathSync(direct); } catch { return direct; }
  }
  const pnpmStore = join(ROOT, 'node_modules', '.pnpm');
  if (existsSync(pnpmStore)) {
    for (const e of readdirSync(pnpmStore, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (
        e.name.startsWith(`${lastName}@`) ||
        e.name.startsWith(`${name.replace('/', '+')}@`)
      ) {
        const candidate = join(pnpmStore, e.name, 'node_modules', lastName);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function requirePkg(name) {
  const src = findPkg(name);
  if (!src) { console.error(`ERROR: ${name} not found in node_modules`); process.exit(1); }
  console.log(`  ${name}: ${src}`);
  return src;
}

/**
 * Recursively copy a package and all its transitive `dependencies` into destNm.
 * Used to copy playwright and its deps alongside the versioned exe.
 */
function copyWithDeps(name, destNm, visited = new Set()) {
  if (visited.has(name)) return;
  visited.add(name);
  const src = findPkg(name);
  if (!src) { console.warn(`  ! dep not found, skipping: ${name}`); return; }
  const destPkg = join(destNm, ...name.split('/'));
  if (!existsSync(destPkg)) {
    mkdirSync(dirname(destPkg), { recursive: true });
    cpSync(src, destPkg, { recursive: true });
    console.log(`  -> ${name}`);
  }
  const meta = join(src, 'package.json');
  if (!existsSync(meta)) return;
  for (const dep of Object.keys(JSON.parse(readFileSync(meta, 'utf8')).dependencies ?? {})) {
    copyWithDeps(dep, destNm, visited);
  }
}

function fileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

// ── Step 1: Build frontend ────────────────────────────────────────────────────

console.log('\n=== Step 1: Build frontend ===');
run('vite build --config vite.demo.config.ts');

// ── Step 2: Compile Electron main + preload ────────────────────────────────────

console.log('\n=== Step 2: Compile Electron entry points ===');
for (const f of ['main.mjs', 'preload.cjs', 'server.cjs', 'package.json']) {
  rmSync(join(DIST_ELECTRON, f), { force: true });
}
rmSync(join(DIST_ELECTRON, 'dist-demo'), { recursive: true, force: true });

run('node scripts/compile-electron.mjs');

// ── Step 3: Bundle backend (esbuild) ─────────────────────────────────────────

console.log('\n=== Step 3: Bundle backend ===');
rmSync(DIST_BACKEND, { recursive: true, force: true });
ensureDir(DIST_BACKEND);

run([
  'esbuild backend/index.js',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node26',
  '--external:*.node',
  '--external:electron',
  '--external:better-sqlite3',
  '--external:node-pty',
  '--external:playwright',
  '--external:playwright-core',
  `--outfile=${DIST_BACKEND}/server.cjs`,
  '--log-level=info',
  '--log-override:empty-import-meta=silent',
  '--log-override:require-resolve-not-external=silent',
].join(' '));

// Copy server.cjs into the Electron app directory.
copyFileSync(join(DIST_BACKEND, 'server.cjs'), join(DIST_ELECTRON, 'server.cjs'));
console.log('  -> dist-electron/server.cjs');

// Copy frontend assets into the Electron app directory.
cpSync(DIST_DEMO, join(DIST_ELECTRON, 'dist-demo'), { recursive: true });
console.log('  -> dist-electron/dist-demo/');

// ── Step 4: Apply better-sqlite3 Electron patch ───────────────────────────────

console.log('\n=== Step 4: Patch better-sqlite3 source for Electron V8 ===');
const PATCH_SQLITE = join(ROOT, 'node_modules', '.pnpm_patches', 'better-sqlite3@12.9.0');
const SQLITE_SRC   = join(ROOT, 'node_modules', 'better-sqlite3');

if (existsSync(PATCH_SQLITE)) {
  cpSync(join(PATCH_SQLITE, 'src'), join(SQLITE_SRC, 'src'), {
    recursive: true,
    force: true,
  });
  console.log('  -> src/ patched (External::New / External::Value type-tag fixes)');
} else {
  console.warn('  WARNING: .pnpm_patches/better-sqlite3@12.9.0 not found.');
  console.warn('  Proceeding without patch — compilation may fail for Electron 42.');
}

// ── Step 5: Rebuild native modules for Electron ───────────────────────────────

console.log(`\n=== Step 5: electron-rebuild (Electron ${ELECTRON_VER}) ===`);
console.log('  Rebuilding: better-sqlite3, node-pty');
console.log('  NOTE: After this step node_modules contains Electron-ABI binaries.');
console.log('  Run `pnpm rebuild` to restore Node.js-ABI binaries for dev usage.');

const rebuildEnv = buildEnv();

if (!rebuildEnv.VCINSTALLDIR) {
  const vcDir = resolveVcInstallDir();
  if (vcDir) rebuildEnv.VCINSTALLDIR = vcDir;
}
if (!rebuildEnv.PYTHON && !rebuildEnv.GYP_PYTHON) {
  const py = resolveGypPython();
  if (py) rebuildEnv.GYP_PYTHON = py;
}

const pathKey = Object.keys(rebuildEnv).find(k => k.toLowerCase() === 'path') ?? 'PATH';
const sysDir = process.env.SystemRoot ?? 'C:\\Windows';
for (const sub of ['System32', 'SysWOW64', '']) {
  const dir = sub ? `${sysDir}\\${sub}` : sysDir;
  if (rebuildEnv[pathKey] === undefined) {
    rebuildEnv[pathKey] = dir;
  } else if (!rebuildEnv[pathKey].includes(dir)) {
    rebuildEnv[pathKey] += `;${dir}`;
  }
}

const NATIVE_PKGS = ['better-sqlite3', 'node-pty'];
const CACHE_ROOT  = join(ROOT, '.electron-cache', ELECTRON_VER);

const relDir = (name) => {
  const hoisted = join(ROOT, 'node_modules', name);
  return join(existsSync(hoisted) ? realpathSync(hoisted) : hoisted, 'build', 'Release');
};
const restoreCache = (name) => {
  const src = join(CACHE_ROOT, name);
  if (!existsSync(src)) return false;
  const files = readdirSync(src).filter(f => f.endsWith('.node'));
  if (!files.length) return false;
  const dst = relDir(name);
  mkdirSync(dst, { recursive: true });
  files.forEach(f => copyFileSync(join(src, f), join(dst, f)));
  console.log(`  [cache hit] ${name}`);
  return true;
};
const saveCache = (name) => {
  const src = relDir(name);
  if (!existsSync(src)) return;
  const files = readdirSync(src).filter(f => f.endsWith('.node'));
  if (!files.length) return;
  const dst = join(CACHE_ROOT, name);
  mkdirSync(dst, { recursive: true });
  files.forEach(f => copyFileSync(join(src, f), join(dst, f)));
  console.log(`  [cached]    ${name}`);
};

const toRebuild = NATIVE_PKGS.filter(n => !restoreCache(n));
if (toRebuild.length === 0) {
  console.log('  All binaries restored from cache — skipping electron-rebuild.');
} else {
  run(
    [
      'electron-rebuild',
      '-f',
      `-w ${toRebuild.join(',')}`,
      `-v ${ELECTRON_VER}`,
    ].join(' '),
    { env: rebuildEnv },
  );
  toRebuild.forEach(n => saveCache(n));
}

// ── Step 6: Prepare Electron app directory ─────────────────────────────────────

console.log('\n=== Step 6: Prepare dist-electron/ for packaging ===');

writeFileSync(
  join(DIST_ELECTRON, 'package.json'),
  JSON.stringify({
    name:    'agent-sdk-app',
    version: pkgJson.version,
    main:    'main.mjs',
  }, null, 2),
  'utf8',
);
console.log('  -> dist-electron/package.json');

const APP_NM = join(DIST_ELECTRON, 'node_modules');
ensureDir(APP_NM);

const sqliteSrc = requirePkg('better-sqlite3');
const ptySrc    = requirePkg('node-pty');

cpSync(sqliteSrc, join(APP_NM, 'better-sqlite3'), {
  recursive: true,
  force:     true,
  filter: (src) => {
    const rel = src.replace(sqliteSrc, '');
    if (rel.startsWith(`${join('build', 'Release')}`) || rel.startsWith('/build/Release')) {
      return true;
    }
    if (/[\\/]build[\\/](?!Release)/.test(rel)) return false;
    if (/[\\/]deps[\\/]/.test(rel)) return false;
    return true;
  },
});
console.log('  -> node_modules/better-sqlite3');

cpSync(ptySrc, join(APP_NM, 'node-pty'), {
  recursive: true,
  force:     true,
  filter: (src) => {
    const rel = src.replace(ptySrc, '');
    if (/[\\/]build[\\/](?!Release)/.test(rel)) return false;
    if (/[\\/]src[\\/]/.test(rel) && /\.(cc?|h|gyp)$/.test(src)) return false;
    return true;
  },
});
console.log('  -> node_modules/node-pty');

const bindingsSrc = findPkg('bindings');
const fileUriSrc  = findPkg('file-uri-to-path');
if (bindingsSrc) {
  cpSync(bindingsSrc, join(APP_NM, 'bindings'), { recursive: true, force: true });
  console.log('  -> node_modules/bindings');
}
if (fileUriSrc) {
  cpSync(fileUriSrc, join(APP_NM, 'file-uri-to-path'), { recursive: true, force: true });
  console.log('  -> node_modules/file-uri-to-path');
}

// ── Step 7: Package Electron app (@electron/packager) ─────────────────────────

console.log('\n=== Step 7: Package Electron app (@electron/packager) ===');
rmSync(DIST_ELECTRON_APP, { recursive: true, force: true });

const [WIN_UNPACKED] = await packager({
  dir: DIST_ELECTRON,
  out: DIST_ELECTRON_APP,
  name: SERVER_NAME,
  platform: 'win32',
  arch: 'x64',
  asar: false,
  electronVersion: ELECTRON_VER,
});
console.log(`  -> ${WIN_UNPACKED}`);

// ── Step 7.5: Inject native node_modules into packaged app ────────────────────

console.log('\n=== Step 7.5: Inject native node_modules into packaged app ===');
if (!existsSync(WIN_UNPACKED)) {
  console.error(`ERROR: packager output not found at ${WIN_UNPACKED}`);
  process.exit(1);
}
cpSync(APP_NM, join(WIN_UNPACKED, 'resources', 'app', 'node_modules'), {
  recursive: true,
  force: true,
});
console.log('  -> resources/app/node_modules/ (better-sqlite3, node-pty, bindings, file-uri-to-path)');

// ── Step 8: Copy win-unpacked/ → release/<version>/ ──────────────────────────

console.log(`\n=== Step 8: Install into release/${BUILD_VER}/ ===`);
if (!existsSync(WIN_UNPACKED)) {
  console.error(`ERROR: packager output not found at ${WIN_UNPACKED}`);
  process.exit(1);
}

ensureDir(VER_DIR);
cpSync(WIN_UNPACKED, VER_DIR, { recursive: true, force: true });

// ── Step 9: Verify Electron exe exists ──────────────────────────────────────

console.log('\n=== Step 9: Verify Electron exe ===');
const serverExe = join(VER_DIR, `${SERVER_NAME}.exe`);
if (existsSync(serverExe)) {
  console.log(`  -> ${SERVER_NAME}.exe`);
} else {
  console.warn(`  ! ${SERVER_NAME}.exe not found in ${VER_DIR}.`);
}

// ── Step 10: Build launcher exe → RELEASE/<LAUNCHER_NAME>.exe ────────────────

console.log('\n=== Step 10: Build launcher ===');

const LAUNCHER_SRC       = join(ROOT, 'scripts', 'launcher.cjs');
const LAUNCHER_EXE       = join(RELEASE, `${LAUNCHER_NAME}.exe`);
const LAUNCHER_HASH_FILE = join(RELEASE, `${LAUNCHER_NAME}.exe.sha256`);

function patchWindowsSubsystem(exePath) {
  if (!existsSync(exePath)) return;
  const buf = readFileSync(exePath);
  if (buf[0] !== 0x4D || buf[1] !== 0x5A) return;
  const peOff = buf.readUInt32LE(0x3C);
  if (buf.readUInt32LE(peOff) !== 0x00004550) return;
  const subOff = peOff + 4 + 20 + 68;
  if (buf.readUInt16LE(subOff) !== 3) return;
  buf.writeUInt16LE(2, subOff);
  writeFileSync(exePath, buf);
  console.log('  [patched] PE subsystem: CONSOLE → WINDOWS (no cmd window on launch)');
}

function launcherUpToDate() {
  if (!existsSync(LAUNCHER_EXE) || !existsSync(LAUNCHER_HASH_FILE)) return false;
  const storedHash  = readFileSync(LAUNCHER_HASH_FILE, 'utf8').trim();
  const currentHash = fileSha256(LAUNCHER_SRC);
  return storedHash === currentHash;
}

if (launcherUpToDate()) {
  console.log(`  -> ${LAUNCHER_NAME}.exe already up-to-date, skipping rebuild.`);
} else {
  try {
    pkgRun([
      'pkg scripts/launcher.cjs',
      '--target node26-win-x64',
      '--no-bytecode',
      '--public',
      `--output ${LAUNCHER_EXE}`,
    ].join(' '));
    writeFileSync(LAUNCHER_HASH_FILE, fileSha256(LAUNCHER_SRC), 'utf8');
    console.log(`  -> ${LAUNCHER_NAME}.exe (launcher)`);
  } catch (err) {
    if (existsSync(LAUNCHER_EXE)) {
      console.warn(
        `  ! WARNING: could not rebuild ${LAUNCHER_NAME}.exe (file in use).` +
        `  The existing launcher will be reused.`,
      );
    } else {
      throw err;
    }
  }
}
patchWindowsSubsystem(LAUNCHER_EXE);

// ── Step 11: Record active version & server name ─────────────────────────────

console.log('\n=== Step 11: Record active version & server name ===');
writeFileSync(join(RELEASE, 'current-version'), BUILD_VER, 'utf8');
writeFileSync(join(RELEASE, 'server-name'),     SERVER_NAME, 'utf8');
console.log(`  -> current-version = ${BUILD_VER}`);
console.log(`  -> server-name     = ${SERVER_NAME}`);

console.log(`\nDone!

  release/
    ${LAUNCHER_NAME}.exe      ← launcher
    current-version          ← ${BUILD_VER}
    server-name              ← ${SERVER_NAME}
    ${BUILD_VER}/
      ${SERVER_NAME}.exe     ← Electron app exe (renamed)
      resources/
        app/
          main.mjs / preload.cjs / server.cjs
          dist-demo/
          node_modules/      ← native bindings rebuilt for Electron
      locales/
      *.dll
    .agent/ / data/ / workspace/  ← shared data (not touched by this build)

Usage:
  cd release
  .\\${LAUNCHER_NAME}.exe                        # start latest version
  .\\${LAUNCHER_NAME}.exe --version ${BUILD_VER}  # start specific version
  .\\${LAUNCHER_NAME}.exe --list                  # list installed versions
`);
