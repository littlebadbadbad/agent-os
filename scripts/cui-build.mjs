#!/usr/bin/env node
/**
 * scripts/cui-build.mjs  —  Build the CUI (console) application for Windows.
 *
 * Uses @yao-pkg/pkg to create a standalone .exe that bundles the backend
 * and serves the frontend static assets over HTTP.
 *
 * Release layout
 * ──────────────
 *   release/
 *     <EXE_NAME>.exe          ← version-selecting launcher  (rebuilt each run)
 *     current-version         ← plain-text name of the active version dir
 *     .agent/                 ┐
 *     data/                   │ shared mutable data — preserved across versions
 *     workspace/              ┘
 *     <BUILD_VERSION>/        ← e.g. "v0.1.0"  (created/overwritten this run)
 *       <EXE_NAME>.exe        ← actual backend server
 *       better_sqlite3.node
 *       pty.node / conpty.node / conpty_console_list.node
 *       dist-demo/
 *
 * Environment overrides
 * ─────────────────────
 *   APP_EXE_NAME      Executable stem, without extension          (default: agent-sdk)
 *   APP_LAUNCHER_NAME Launcher exe stem (overrides APP_EXE_NAME)  (default: APP_EXE_NAME)
 *   APP_SERVER_NAME   Server exe stem   (overrides APP_EXE_NAME)  (default: APP_EXE_NAME)
 *   BUILD_VERSION     Version directory name                      (default: v<package.version>)
 */

import {
  cpSync, mkdirSync, rmSync, existsSync,
  readdirSync, copyFileSync, writeFileSync, readFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { run, buildEnv, applyDotEnv } from './runtime.mjs';

const _require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

applyDotEnv();

// ── Configuration ─────────────────────────────────────────────────────────────

const pkgJson      = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const _ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  .replace(/^(\d{8})(\d{6})$/, '$1-$2');
const BUILD_VER     = process.env.BUILD_VERSION    ?? `v${pkgJson.version}-${_ts}`;
const LAUNCHER_NAME = process.env.APP_LAUNCHER_NAME ?? process.env.APP_EXE_NAME ?? 'agent-sdk';
const SERVER_NAME   = process.env.APP_SERVER_NAME   ?? process.env.APP_EXE_NAME ?? 'agent-sdk';

const DIST_BACKEND  = join(ROOT, 'dist-backend');
const DIST_DEMO     = join(ROOT, 'dist-demo');
const RELEASE       = join(ROOT, 'release');
const VER_DIR       = join(RELEASE, BUILD_VER);

// ── Helpers ───────────────────────────────────────────────────────────────────

function pkgRun(cmd) {
  const env = buildEnv();
  if (env.PKG_CACHE_PATH) env.PKG_CACHE_PATH = resolve(env.PKG_CACHE_PATH);
  run(cmd, { env });
}

function ensureDir(d) { mkdirSync(d, { recursive: true }); }

function findPkg(name) {
  const lastName = name.includes('/') ? name.split('/').pop() : name;

  // 1. Use Node's module resolution — correctly follows pnpm symlinks to the
  //    .pnpm store, picking the same version that `require(name)` loads.
  //    This avoids the alphabetical-scan bug that picks older versions first.
  try {
    const pkgPath = _require.resolve(`${name}/package.json`);
    return dirname(pkgPath);
  } catch {
    // fall through to legacy pnpm store scan
  }

  // 2. Legacy fallback: scan .pnpm store for matching entries.
  const pnpmStore = join(ROOT, 'node_modules', '.pnpm');
  if (existsSync(pnpmStore)) {
    let best = null;
    for (const e of readdirSync(pnpmStore, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (
        e.name.startsWith(`${lastName}@`) ||
        e.name.startsWith(`${name.replace('/', '+')}@`)
      ) {
        const candidate = join(pnpmStore, e.name, 'node_modules', lastName);
        if (existsSync(candidate) && (!best || e.name > best)) best = e.name;
      }
    }
    if (best) {
      return join(pnpmStore, best, 'node_modules', lastName);
    }
  }

  // 3. Direct node_modules (flat install, no pnpm).
  const direct = join(ROOT, 'node_modules', name);
  return existsSync(direct) ? direct : null;
}

function requirePkg(name) {
  const src = findPkg(name);
  if (!src) { console.error(`ERROR: ${name} not found in node_modules`); process.exit(1); }
  console.log(`  ${name}: ${src}`);
  return src;
}

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

  const pkgJsonPath = join(src, 'package.json');
  if (!existsSync(pkgJsonPath)) return;
  const meta = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  for (const dep of Object.keys(meta.dependencies ?? {})) {
    copyWithDeps(dep, destNm, visited);
  }
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const pluginsIdx = args.indexOf('--plugins');
if (pluginsIdx !== -1 && args[pluginsIdx + 1]) {
  process.env.PLUGIN_FILTER = args[pluginsIdx + 1];
  console.log(`  --plugins = ${process.env.PLUGIN_FILTER}`);
}

// ── Step 1: Build frontend ────────────────────────────────────────────────────

console.log('\n=== Step 1: Build frontend ===');
run('vite build --config vite.demo.config.ts');

// ── Step 1.5: Compile all extensions into plugins/ ───────────────────────────

console.log('\n=== Step 1.5: Compile plugins ===');
run('node scripts/compile-plugins.mjs');

// ── Step 2: Bundle backend (esbuild) ─────────────────────────────────────────

console.log('\n=== Step 2: Bundle backend ===');
rmSync(DIST_BACKEND, { recursive: true, force: true });
ensureDir(DIST_BACKEND);

run([
  'esbuild backend/index.js',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node26',
  '--external:*.node',  '--external:electron',  '--external:better-sqlite3',
  '--external:node-pty',
  '--external:playwright',
  '--external:playwright-core',
  `--outfile=${DIST_BACKEND}/server.cjs`,
  '--log-level=info',
  '--log-override:empty-import-meta=silent',
  '--log-override:require-resolve-not-external=silent',
].join(' '));

// ── Step 3: Collect native packages into dist-backend/ ───────────────────────

console.log('\n=== Step 3: Copy native packages ===');
const NM_DEST = join(DIST_BACKEND, 'node_modules');
ensureDir(NM_DEST);

const sqliteSrc      = requirePkg('better-sqlite3');
const ptySrc         = requirePkg('node-pty');

cpSync(sqliteSrc, join(NM_DEST, 'better-sqlite3'), { recursive: true });
cpSync(ptySrc,    join(NM_DEST, 'node-pty'),       { recursive: true });

const bindingsSrc = findPkg('bindings');
const fileUriSrc  = findPkg('file-uri-to-path');
if (bindingsSrc) { cpSync(bindingsSrc, join(NM_DEST, 'bindings'),          { recursive: true }); console.log('  bindings'); }
if (fileUriSrc)  { cpSync(fileUriSrc,  join(NM_DEST, 'file-uri-to-path'), { recursive: true }); console.log('  file-uri-to-path'); }

// ── Step 3.5: Rebuild better-sqlite3 for pkg's Node 22 target ────────────────
// The .node file copied in Step 3 was compiled against the host Node.js ABI
// (Node 26, NODE_MODULE_VERSION=147).  pkg embeds Node 22 (ABI 127), so we
// must rebuild targeting the correct ABI.  Without this the packed .exe would
// crash with a "compiled against different Node.js version" error.

console.log('\n=== Step 3.5: Rebuild better-sqlite3 for Node 22 (pkg target) ===');

const sqliteRebuildDir = join(NM_DEST, 'better-sqlite3');
{
  const nodeGypEnv = {
    ...buildEnv(),
    npm_config_target: '22.22.2',
    npm_config_arch: 'x64',
    npm_config_disturl: 'https://nodejs.org/dist',
  };
  run('npx node-gyp rebuild --release', {
    cwd: sqliteRebuildDir,
    env: nodeGypEnv,
  });
}
console.log('  -> rebuilt better_sqlite3.node for Node 22');

// ── Step 4: Package server exe → VER_DIR/<EXE_NAME>.exe ──────────────────────

console.log(`\n=== Step 4: Package server (${BUILD_VER}) ===`);
ensureDir(VER_DIR);

writeFileSync(
  join(DIST_BACKEND, 'package.json'),
  JSON.stringify({
    name: 'agent-sdk-server',
    version: pkgJson.version,
    main: 'server.cjs',
    pkg: {
      targets: ['node22-win-x64'],
      assets: [
        'node_modules/better-sqlite3/build/**',
        'node_modules/node-pty/prebuilds/**',
        'node_modules/node-pty/build/**',
      ],
      scripts: [
        'node_modules/better-sqlite3/**/*.js',
        'node_modules/node-pty/**/*.js',
        'node_modules/bindings/**/*.js',
        'node_modules/file-uri-to-path/**/*.js',
      ],
    },
  }, null, 2),
  'utf8',
);

pkgRun([
  'pkg dist-backend/server.cjs',
  '--target node22-win-x64',
  '--no-bytecode',
  '--public-packages "*"',
  '--public',
  `--output ${join(VER_DIR, `${SERVER_NAME}.exe`)}`,
].join(' '));

// ── Step 5: Copy runtime assets into VER_DIR ─────────────────────────────────

console.log('\n=== Step 5: Copy runtime assets ===');

const sqliteNode = join(NM_DEST, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (existsSync(sqliteNode)) {
  copyFileSync(sqliteNode, join(VER_DIR, 'better_sqlite3.node'));
  console.log('  -> better_sqlite3.node');
}

const ptyPrebuilds = join(ptySrc, 'prebuilds', 'win32-x64');
if (existsSync(ptyPrebuilds)) {
  for (const f of readdirSync(ptyPrebuilds)) {
    if (!f.endsWith('.node')) continue;
    try {
      copyFileSync(join(ptyPrebuilds, f), join(VER_DIR, f));
      console.log(`  -> ${f}`);
    } catch (e) {
      console.warn(`  ! skipped ${f}: ${e.message}`);
    }
  }
}

cpSync(DIST_DEMO, join(VER_DIR, 'dist-demo'), { recursive: true });
console.log('  -> dist-demo/');

console.log('  -> node_modules/playwright (+ transitive deps):');
const playwrightNm = join(VER_DIR, 'node_modules');
ensureDir(playwrightNm);
copyWithDeps('playwright',      playwrightNm);
copyWithDeps('playwright-core', playwrightNm);

// ── Step 5.5: Copy plugins into release/ ─────────────────────────────────────

console.log('\n=== Step 5.5: Copy plugins into release/ ===');
const PLUGINS_SRC = join(ROOT, 'plugins');
const PLUGINS_DST = join(RELEASE, 'plugins');
if (existsSync(PLUGINS_SRC)) {
  rmSync(PLUGINS_DST, { recursive: true, force: true });
  mkdirSync(PLUGINS_DST, { recursive: true });
  cpSync(PLUGINS_SRC, PLUGINS_DST, { recursive: true, force: true });
  console.log('  -> plugins/');
}

// ── Step 6: Build launcher exe → RELEASE/<EXE_NAME>.exe ──────────────────────

console.log('\n=== Step 6: Build launcher ===');

const LAUNCHER_SRC      = join(ROOT, 'scripts', 'launcher.cjs');
const LAUNCHER_EXE      = join(RELEASE, `${LAUNCHER_NAME}.exe`);
const LAUNCHER_HASH_FILE = join(RELEASE, `${LAUNCHER_NAME}.exe.sha256`);

function fileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

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
      '--target node22-win-x64',
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

// ── Step 7: Write current-version ────────────────────────────────────────────

console.log('\n=== Step 7: Record active version & server name ===');
writeFileSync(join(RELEASE, 'current-version'), BUILD_VER,    'utf8');
writeFileSync(join(RELEASE, 'server-name'),     SERVER_NAME,  'utf8');
console.log(`  -> current-version = ${BUILD_VER}`);
console.log(`  -> server-name     = ${SERVER_NAME}`);

console.log(`\nDone!

  release/
    ${LAUNCHER_NAME}.exe      ← launcher
    current-version          ← ${BUILD_VER}
    server-name              ← ${SERVER_NAME}
    ${BUILD_VER}/
      ${SERVER_NAME}.exe     ← server
      *.node
      dist-demo/
    plugins/ / .agent/ / data/ / workspace/  ← shared data (not touched by this build)

Usage:
  cd release
  .\\${LAUNCHER_NAME}.exe                        # start latest version
  .\\${LAUNCHER_NAME}.exe --version ${BUILD_VER}  # start specific version
  .\\${LAUNCHER_NAME}.exe --list                  # list installed versions
`);
