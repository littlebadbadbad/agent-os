#!/usr/bin/env node
/**
 * scripts/gui-rebuild-native.mjs  —  Rebuild native modules for the Electron ABI.
 *
 * Uses @electron/rebuild's programmatic API via createRequire (CJS compat).
 *
 * Usage
 * ─────
 *   node scripts/gui-rebuild-native.mjs
 *   pnpm run gui:rebuild-native
 *
 * After running, the .node files in node_modules are Electron-ABI builds.
 * Run `pnpm rebuild` to restore Node.js-ABI builds for normal dev usage.
 *
 * Environment overrides
 * ─────────────────────
 *   ELECTRON_VERSION  Electron version to rebuild for (default: from package.json)
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const electronVersion = process.env.ELECTRON_VERSION ?? pkg.devDependencies?.electron;

if (!electronVersion) {
  console.error('ERROR: Could not determine Electron version. Set ELECTRON_VERSION env or add electron to devDependencies.');
  process.exit(1);
}

console.log(`\n=== electron-rebuild (Electron ${electronVersion}) ===`);

const { rebuild } = require('@electron/rebuild');

await rebuild({
  buildPath: ROOT,
  electronVersion,
  onlyModules: ['better-sqlite3', 'node-pty'],
  force: true,
});

console.log('\nDone. Native modules rebuilt for Electron ABI.');
console.log('Run `pnpm rebuild` to restore Node.js-ABI builds.\n');
