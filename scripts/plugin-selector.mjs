#!/usr/bin/env node
/**
 * scripts/plugin-selector.mjs  —  Interactive plugin selection for dev mode.
 *
 * Scans extensions/ for valid plugins and presents an interactive checkbox prompt.
 *
 * Features
 * ────────
 *   • Space to toggle selection
 *   • Arrow keys (↑/↓) to navigate
 *   • Ctrl+A to select all / Ctrl+R to toggle all
 *   • Type to filter/search
 *   • Default: none selected (unless --all is passed)
 *   • Supports programmatic API with filter pre-selection
 *
 * Usage
 * ─────
 *   node scripts/plugin-selector.mjs            # interactive prompt
 *   node scripts/plugin-selector.mjs --all      # select all, skip prompt
 *
 * Environment variables
 * ─────────────────────
 *   PLUGIN_FILTER       Comma-separated plugin names (e.g. "browser,cron")
 *                       Skips the interactive prompt and uses this list directly.
 *
 * Exports
 * ───────
 *   selectPlugins(options?)  →  Promise<string[]>
 *
 * @typedef {Object} SelectPluginsOptions
 * @property {boolean} [all]          — If true, select all plugins without prompt.
 * @property {string[]} [filter]      — Pre-select specific plugins, skip prompt.
 * @property {boolean} [required]     — If true, at least one selection is required (default: false).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { checkbox } from '@inquirer/prompts';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, '..');
const EXTENSIONS = resolve(ROOT, 'extensions');

// ── Types (JSDoc) ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PluginInfo
 * @property {string} name        — Directory name (e.g. "browser")
 * @property {string} displayName — Human-readable name from manifest
 * @property {string} description — Short description from manifest
 */

// ── Plugin discovery ──────────────────────────────────────────────────────────

/**
 * Scan extensions/ directories and return those with valid plugin structure.
 * @returns {PluginInfo[]}
 */
function discoverPlugins() {
  if (!existsSync(EXTENSIONS)) return [];

  /** @type {PluginInfo[]} */
  const result = [];

  for (const name of readdirSync(EXTENSIONS)) {
    const dir = join(EXTENSIONS, name);
    if (!statSync(dir).isDirectory()) continue;

    const manifestPath = join(dir, 'manifest.json');
    const pkgPath      = join(dir, 'package.json');

    if (!existsSync(manifestPath) || !existsSync(pkgPath)) continue;

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      result.push({
        name,
        displayName: manifest.name ?? name,
        description: manifest.description ?? '',
      });
    } catch {
      // skip malformed manifests
    }
  }

  // Sort alphabetically for consistent display order
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// ── Interactive prompt ────────────────────────────────────────────────────────

/**
 * Show an interactive checkbox prompt using @inquirer/checkbox.
 *
 * @param {PluginInfo[]} plugins  — Available plugins
 * @param {Object}        [opts]
 * @param {boolean}       [opts.required=false]
 * @returns {Promise<string[]>}  — Selected plugin names
 */
async function showCheckboxPrompt(plugins, opts = {}) {

  const choices = plugins.map((p) => ({
    name: p.displayName,
    value: p.name,
    description: p.description || undefined,
    checked: false,
  }));

  const selected = await checkbox({
    message: 'Select plugins to bundle (Space=toggle, ↑↓=move, Ctrl+A=all, type=filter)',
    choices,
    required: opts.required ?? false,
    pageSize: 15,
    loop: true,
  });

  return /** @type {string[]} */ (selected);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {SelectPluginsOptions} [options]
 * @returns {Promise<string[]>}
 */
export async function selectPlugins(options = {}) {
  const plugins = discoverPlugins();

  if (plugins.length === 0) {
    console.log('No plugins found — extensions/ directory is empty.');
    return [];
  }

  // Priority: explicit filter list > --all flag > interactive prompt
  if (options.filter && options.filter.length > 0) {
    const valid = options.filter.filter((name) =>
      plugins.some((p) => p.name === name),
    );
    if (valid.length === 0) {
      console.log('⚠  None of the requested plugins were found in extensions/.');
    }
    return valid;
  }

  if (options.all) {
    return plugins.map((p) => p.name);
  }

  // Interactive prompt — only if stdin is a TTY
  if (!process.stdin.isTTY) {
    console.log('  ℹ  Non-interactive terminal detected — selecting all plugins by default.');
    return plugins.map((p) => p.name);
  }

  return showCheckboxPrompt(plugins, { required: options.required });
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const allFlag = args.includes('--all');

  // Check if PLUGIN_FILTER env var is set (used when called from other scripts)
  const envFilter = process.env.PLUGIN_FILTER
    ? process.env.PLUGIN_FILTER.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const selected = await selectPlugins({
    all: allFlag,
    filter: envFilter,
  });

  if (selected.length > 0) {
    console.log(`\n✔  Selected ${selected.length} plugin(s): ${selected.join(', ')}`);
  } else {
    console.log('\nℹ  No plugins selected — skipping plugin compilation.');
  }

  // Output selected plugins as comma-separated to stdout
  // So calling scripts can capture it easily
  process.stdout.write(selected.join(','));
}

// Allow running as standalone CLI
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error('\n✖  Plugin selection error:', err.message);
    process.exit(1);
  });
}
