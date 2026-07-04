/**
 * backend/lib/toolEnv.js — Tool execution environment
 *
 * Establishes the npm package scope under data/tool-scripts/ so that:
 *   - Backend tools can import npm packages:  import axios from 'axios'
 *   - Backend tools can import shared modules: import { x } from '#modules/name'
 *     (at runtime #modules/name is rewritten to a temp-copy path for cache busting;
 *      the package.json imports field doubles as IDE/tooling hint)
 *
 * Directory layout (all under data/tool-scripts/):
 *   package.json    npm package scope, imports map
 *   node_modules/   third-party deps installed via install_tool_deps
 *   modules/        shared module source files  (<name>.mjs)
 *   _exec/          ephemeral per-execution temp copies (cleaned on startup)
 *
 * Call ensureToolEnv() once at server startup before any tool is executed.
 */

import { mkdirSync, existsSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { DATA_ROOT } from './paths.js';

/** Root of the npm-package scope that tool scripts execute within. */
export const TOOL_SCRIPTS_DIR = join(DATA_ROOT, 'tool-scripts');

/** Shared module source files: <name>.mjs lives here. */
export const TOOL_MODULES_DIR = join(TOOL_SCRIPTS_DIR, 'modules');

/** Ephemeral per-execution temp copies (tool script + module copies). */
export const TOOL_EXEC_DIR = join(TOOL_SCRIPTS_DIR, '_exec');

// ── Startup initialisation ────────────────────────────────────────────────────

/**
 * Idempotently set up the tool execution environment.
 *
 * - Creates required directories.
 * - Writes package.json (if absent) with type:module and imports map.
 * - Purges any stale files left in _exec/ by a previous crashed process.
 *
 * Safe to call multiple times; only performs I/O on first call or when
 * _exec/ contains orphaned files.
 */
export function ensureToolEnv() {
  mkdirSync(TOOL_MODULES_DIR, { recursive: true });
  mkdirSync(TOOL_EXEC_DIR,    { recursive: true });

  // Write package.json once (never overwrite — user may have added deps).
  const pkgFile = join(TOOL_SCRIPTS_DIR, 'package.json');
  if (!existsSync(pkgFile)) {
    writeFileSync(pkgFile, JSON.stringify({
      name:    'tool-scripts',
      version: '1.0.0',
      private: true,
      type:    'module',
      // IDE/tooling hint for #modules/* imports.
      // At runtime the import is rewritten to a temp-copy path for cache busting.
      imports: { '#modules/*': './modules/*.mjs' },
    }, null, 2) + '\n', 'utf8');
  }

  // Purge _exec/ — anything left here is a crash artefact.
  let purged = 0;
  for (const f of readdirSync(TOOL_EXEC_DIR)) {
    try { unlinkSync(join(TOOL_EXEC_DIR, f)); purged++; } catch { /* concurrent deletion — ok */ }
  }
  if (purged > 0) {
    console.log(`[toolEnv] purged ${purged} stale file(s) from _exec/`);
  }
}
