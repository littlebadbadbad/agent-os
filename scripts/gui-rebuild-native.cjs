#!/usr/bin/env node
/**
 * scripts/gui-rebuild-native.cjs  —  Rebuild native modules for the Electron ABI.
 *
 * Thin wrapper around @electron/rebuild's programmatic API.
 * This is a .cjs file to avoid ESM/CJS interop issues with @electron/rebuild.
 *
 * Usage
 * ─────
 *   node scripts/gui-rebuild-native.cjs
 *   pnpm run gui:rebuild-native
 *
 * After running, the .node files in node_modules are Electron-ABI builds.
 * Run `pnpm rebuild` to restore Node.js-ABI builds for normal dev usage.
 *
 * Environment overrides
 * ─────────────────────
 *   ELECTRON_VERSION  Electron version to rebuild for (default: from package.json)
 */

const { rebuild } = require('@electron/rebuild');
const { readFileSync } = require('fs');
const { join, resolve, dirname } = require('path');

const ROOT = resolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const electronVersion = process.env.ELECTRON_VERSION ?? pkg.devDependencies?.electron;

if (!electronVersion) {
  console.error('ERROR: Could not determine Electron version. Set ELECTRON_VERSION env or add electron to devDependencies.');
  process.exit(1);
}

console.log(`\n=== electron-rebuild (Electron ${electronVersion}) ===`);

rebuild({
  buildPath: ROOT,
  electronVersion,
  onlyModules: ['better-sqlite3', 'node-pty'],
  force: true,
}).then(() => {
  console.log('\nDone. Native modules rebuilt for Electron ABI.');
  console.log('Run `pnpm rebuild` to restore Node.js-ABI builds.\n');
}).catch((err) => {
  console.error('\nRebuild failed:', err.message);
  process.exit(1);
});
