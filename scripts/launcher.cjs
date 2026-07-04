'use strict';

/**
 * Agent SDK Launcher
 *
 * This executable lives at  release/<EXE_NAME>.exe
 * and delegates to the actual server in a versioned sub-directory:
 *   release/<version>/<EXE_NAME>.exe
 *
 * Version resolution (first match wins):
 *   1. --version <name>   explicit CLI flag
 *   2. current-version    plain-text file next to this exe
 *   3. (auto)             lexicographically latest versioned directory
 *
 * Other flags:
 *   --list    print available versions and exit
 *
 * The executable stem is controlled by APP_EXE_NAME (default: agent-sdk).
 * All unrecognised arguments are forwarded verbatim to the server exe.
 */

const { spawn } = require('child_process');
const path  = require('path');
const fs    = require('fs');

const RELEASE_DIR = path.dirname(process.execPath);

// The server executable stem is written to disk by the build script.
// Reading it here decouples the launcher filename from the server filename;
// no environment variables are needed at runtime.
const _serverNameFile = path.join(RELEASE_DIR, 'server-name');
const SERVER_NAME = fs.existsSync(_serverNameFile)
  ? fs.readFileSync(_serverNameFile, 'utf8').trim() || 'agent-sdk'
  : 'agent-sdk';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return sorted list of version directory names that contain the server exe. */
function versionDirs() {
  return fs
    .readdirSync(RELEASE_DIR, { withFileTypes: true })
    .filter(
      e =>
        e.isDirectory() &&
        fs.existsSync(path.join(RELEASE_DIR, e.name, `${SERVER_NAME}.exe`)),
    )
    .map(e => e.name)
    .sort();
}

function readCurrentVersion() {
  const file = path.join(RELEASE_DIR, 'current-version');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() || null : null;
}

function readPreviousVersion() {
  const file = path.join(RELEASE_DIR, 'previous-version');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() || null : null;
}

/**
 * Snapshot the active version into `previous-version` so we can roll back if
 * the next launch crashes.  No-op when the active version is already the
 * recorded previous (avoids losing the last-known-good when restarting
 * repeatedly on a broken version).
 */
function recordPreviousVersion(ver) {
  if (!ver) return;
  const file = path.join(RELEASE_DIR, 'previous-version');
  try {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
    if (existing === ver) return;
    fs.writeFileSync(file, ver, 'utf8');
  } catch (e) {
    console.warn(`[launcher] could not write previous-version: ${e.message}`);
  }
}

function versionExists(ver) {
  return !!ver && fs.existsSync(path.join(RELEASE_DIR, ver, `${SERVER_NAME}.exe`));
}

// ── CLI parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--list')) {
  const current = readCurrentVersion();
  const dirs    = versionDirs();
  if (dirs.length === 0) {
    console.log('No versions available.');
  } else {
    console.log('Available versions:');
    for (const d of dirs) console.log(`  ${d === current ? '*' : ' '} ${d}`);
  }
  process.exit(0);
}

let version    = null;
let forwardArgs = args;

const vIdx = args.indexOf('--version');
if (vIdx !== -1) {
  version     = args[vIdx + 1] ?? null;
  forwardArgs = args.filter((_, i) => i !== vIdx && i !== vIdx + 1);
}

// `--rollback` forces booting the recorded previous-version (manual recovery).
let manualRollback = false;
if (forwardArgs.includes('--rollback')) {
  manualRollback = true;
  forwardArgs = forwardArgs.filter((a) => a !== '--rollback');
  const prev = readPreviousVersion();
  if (!versionExists(prev)) {
    console.error('[launcher] --rollback requested but no valid previous-version found.');
    process.exit(1);
  }
  console.log(`[launcher] --rollback → ${prev}`);
  version = prev;
}

// ── Version resolution ────────────────────────────────────────────────────────

if (!version) version = readCurrentVersion();

if (!version) {
  const dirs = versionDirs();
  version = dirs.length ? dirs[dirs.length - 1] : null;
}

if (!version) {
  console.error('[launcher] No version found. Run a build first, or pass --version <name>.');
  process.exit(1);
}

// ── Spawn server ──────────────────────────────────────────────────────────────

// ── Restart loop constants ────────────────────────────────────────────────────

/** Exit code sent by the server to request a restart with the new version. */
const RESTART_CODE      = 75;   // POSIX EX_TEMPFAIL — "temporary failure, please retry"
const MAX_RESTARTS      = 5;    // maximum restarts allowed within RESTART_WINDOW_MS
const RESTART_WINDOW_MS = 10_000;

/** Timestamps of recent RESTART_CODE exits used for crash-loop detection. */
const restartTimestamps = [];

function isCrashLooping() {
  const now = Date.now();
  while (restartTimestamps.length && now - restartTimestamps[0] > RESTART_WINDOW_MS) {
    restartTimestamps.shift();
  }
  return restartTimestamps.length >= MAX_RESTARTS;
}

// ── Spawn loop ────────────────────────────────────────────────────────────────

function run(ver) {
  const targetExe = path.join(RELEASE_DIR, ver, `${SERVER_NAME}.exe`);

  if (!fs.existsSync(targetExe)) {
    console.error(`[launcher] Executable not found for version "${ver}": ${targetExe}`);
    const prev = readPreviousVersion();
    if (!manualRollback && versionExists(prev) && prev !== ver) {
      console.error(`[launcher] Falling back to previous-version: ${prev}`);
      manualRollback = true;
      run(prev);
      return;
    }
    process.exit(1);
  }

  console.log(`[launcher] Launching ${ver}/${SERVER_NAME}.exe`);

  const child = spawn(targetExe, forwardArgs, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: false,
  });

  child.on('error', err => {
    console.error(`[launcher] Failed to start: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (code === RESTART_CODE) {
      restartTimestamps.push(Date.now());
      if (isCrashLooping()) {
        console.error(
          `[launcher] Restarted ${MAX_RESTARTS} times within ${RESTART_WINDOW_MS / 1_000} s — ` +
          'possible crash loop. Giving up.',
        );
        process.exit(1);
      }

      // The server exited cleanly via RESTART_CODE — the version that just
      // ran qualifies as the new previous-version (last known good).
      recordPreviousVersion(ver);

      // Re-read current-version: the build script may have updated it.
      const nextVer = readCurrentVersion() ?? ver;
      console.log(`[launcher] Restarting → ${nextVer}`);
      run(nextVer);
      return;
    }

    // Abnormal exit — try one automatic rollback, then give up.
    const crashed = (code ?? 0) !== 0;
    const prev = readPreviousVersion();
    if (crashed && !manualRollback && versionExists(prev) && prev !== ver) {
      console.error(
        `[launcher] Version ${ver} exited abnormally (code=${code}, signal=${signal}). ` +
        `Rolling back to ${prev} — pass «--version ${ver}» to retry.`,
      );
      manualRollback = true;
      run(prev);
      return;
    }

    process.exit(code ?? (signal ? 1 : 0));
  });
}

run(version);
