#!/usr/bin/env node
/**
 * scripts/compile-plugins.mjs  —  Orchestrate plugin compilation.
 *
 * For each sub-directory under extensions/ that has a package.json and a
 * manifest.json, this script runs the plugin's own build command (defined
 * in the plugin's package.json `scripts.build`), then copies manifest.json
 * and a cleaned package.json into the plugins/ output directory.
 *
 * Each plugin is responsible for its own compilation — tooling, platform
 * targeting, bundling, and output path are all controlled by the plugin's
 * own build script.  This script only orchestrates execution and copies
 * the metadata files.
 *
 * Convention:
 *   - Plugin builds output to `plugins/<plugin-name>/` (relative to repo root)
 *   - Plugin build scripts receive `PLUGIN_OUT_DIR` env var pointing there
 *   - The build script can use `process.env.PLUGIN_OUT_DIR` to know where
 *     to place compiled artifacts
 *
 * Run: node scripts/compile-plugins.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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

  // ── Run the plugin's own build command ──────────────────────────────────
  // Each plugin controls its compilation entirely — tool, platform, bundling.
  // The plugin receives PLUGIN_OUT_DIR so it knows where to output artifacts.
  console.log(`\n━━━ Building plugin: ${name} ━━━`);

  if (pkg.scripts?.build) {
    try {
      execSync(pkg.scripts.build, {
        cwd: srcDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          PLUGIN_OUT_DIR: outDir,
          PLUGIN_NAME: name,
        },
      });
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
