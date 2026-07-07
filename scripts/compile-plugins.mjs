#!/usr/bin/env node
/**
 * scripts/compile-plugins.mjs  —  Orchestrate plugin compilation.
 *
 * For each sub-directory under extensions/ that has a package.json and a
 * manifest.json, runs the plugin's single `build` command (defined in
 * package.json), then copies manifest.json and a cleaned package.json
 * into the plugins/ output directory.
 *
 * Convention:
 *   - Each plugin has ONE build script (`scripts.build`) that compiles
 *     everything: agent entry, backend entry, AND UI entry (Vite).
 *   - The orchestrator does NOT run separate build:ui — each plugin's
 *     build script handles all artifacts in one invocation.
 *   - Plugin builds output to `plugins/<plugin-name>/` (relative to repo root)
 *   - Plugin build scripts receive `PLUGIN_OUT_DIR` env var pointing there
 *
 * Run: node scripts/compile-plugins.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT           = resolve(__dirname, '..');
const EXTENSIONS_DIR = resolve(ROOT, 'extensions');
const PLUGINS_DIR    = resolve(ROOT, 'plugins');

/** Read and parse a JSON file, returning null on ENOENT. */
function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Run a build command with retry on transient failure (eg. antivirus/DLP file lock).
 *
 * Some security software (EsafeNet Cobra DocGuard, Windows Defender, etc.) holds
 * temporary exclusive locks on newly written files.  When esbuild writes a .js
 * and immediately writes its .map, the scanner may still hold the lock — causing
 * a spurious "Access is denied" error.  Retrying after a short delay works around it.
 */
async function runWithRetry(cmd, opts, { label, maxRetries = 2, delayMs = 1500 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync(cmd, opts);
      return; // success
    } catch (err) {
      const isLast = attempt === maxRetries;
      const note = isLast ? '' : ` (retry ${attempt}/${maxRetries - 1} in ${delayMs}ms…)`;
      console.error(`  ✖  ${label} build failed: ${err.message}${note}`);

      if (isLast) throw err; // re-throw on final attempt

      await sleep(delayMs);
    }
  }
}

/** List sub-directories of a given directory. */
function listDirs(parent) {
  if (!existsSync(parent)) return [];
  return readdirSync(parent).filter(name =>
    statSync(join(parent, name)).isDirectory(),
  );
}

const pluginNames = listDirs(EXTENSIONS_DIR);

if (pluginNames.length === 0) {
  console.log('No plugins found — extensions/ directory is empty.');
  process.exit(0);
}

for (const name of pluginNames) {
  const srcDir   = join(EXTENSIONS_DIR, name);
  const manifest = readJSON(join(srcDir, 'manifest.json'));
  const pkg      = readJSON(join(srcDir, 'package.json'));

  if (!manifest) {
    console.log(`  ⚠  ${name}: no manifest.json — skipping.`);
    continue;
  }
  if (!pkg) {
    console.log(`  ⚠  ${name}: no package.json — skipping.`);
    continue;
  }

  const outDir = join(PLUGINS_DIR, name);
  mkdirSync(outDir, { recursive: true });

  // ── Clean old output files ────────────────────────────────────────────────
  // DLP/antivirus software (EsafeNet Cobra DocGuard, Windows Defender, etc.)
  // may hold an exclusive lock on previously written output files, causing
  // esbuild's write to fail with "Access is denied".  Deleting before writing
  // avoids overwriting a locked file entirely.
  for (const entry of readdirSync(outDir)) {
    const fp = join(outDir, entry);
    try {
      rmSync(fp, { recursive: true, force: true });
    } catch {
      // Best-effort — if the lock is too strong even for delete, the build's
      // own retry mechanism will handle it.
    }
  }

  // ── Run the plugin's own build command ──────────────────────────────────
  // Each plugin controls its compilation entirely — agent entry, backend
  // entry, and UI entry (Vite) are all handled by a single `build` script.
  // The plugin receives PLUGIN_OUT_DIR so it knows where to output artifacts.
  console.log(`\n━━━ Building plugin: ${name} ━━━`);

  if (pkg.scripts?.build) {
    try {
      await runWithRetry(pkg.scripts.build, {
        cwd: srcDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          PLUGIN_OUT_DIR: outDir,
          PLUGIN_NAME: name,
        },
      }, { label: name });
      console.log(`  ✔  ${name} build succeeded`);
    } catch (err) {
      console.error(`  ✖  ${name} build failed: ${err.message}`);
      process.exitCode = 1;
      continue;
    }
  } else {
    console.log(`  ℹ  ${name}: no build script defined — skipping compilation.`);
  }

  // ── Copy manifest ─────────────────────────────────────────────────────────
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  // ── Copy package.json (strip devDependencies) ──────────────────────────────
  const { devDependencies, ...cleanPkg } = pkg;
  writeFileSync(
    join(outDir, 'package.json'),
    JSON.stringify(cleanPkg, null, 2),
  );

  console.log(`  ✔  ${name} → plugins/${name}/`);
}

console.log(`\nDone — ${pluginNames.length} plugin(s) processed.`);
