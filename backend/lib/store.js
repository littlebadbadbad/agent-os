/**
 * Tool store — SQLite-backed with per-tool script files.
 *
 * Layout:
 *   backend/tools.db                 — SQLite database (metadata only)
 *   backend/tool-scripts/<name>.js   — complete Node.js 22 ESM module per tool
 *   workspace/tmp/                  — transient copies used during execution
 *
 * Each tool script is a full ESM module that exports `async function run(args)`.
 * Top-level `import` statements are allowed and encouraged.
 *
 * The database stores name, description, parameters (JSON string), and created_at.
 * The actual JavaScript module lives in `tool-scripts/<name>.js` so it can
 * be inspected, diffed, or edited directly as a plain file.
 *
 * On first boot the legacy `tools.json` is automatically migrated and renamed to
 * `tools.json.migrated` so nothing is lost.
 *
 * Public API:
 *   listTools()                          → ToolEntry[]
 *   getTool(name)                        → ToolEntry | undefined
 *   upsertTool({ name, description, parameters, implementation })
 *   removeTool(name)                     → boolean
 *   executeTool(name, args)              → Promise<unknown>
 */

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { DATA_ROOT, SQLITE_BINDING } from './paths.js';
import { TOOL_SCRIPTS_DIR, TOOL_MODULES_DIR, TOOL_EXEC_DIR, ensureToolEnv } from './toolEnv.js';

const DB_FILE      = join(DATA_ROOT, 'tools.db');
const SCRIPTS_DIR  = TOOL_SCRIPTS_DIR; // convenience alias kept for internal use
const LEGACY_JSON  = join(DATA_ROOT, 'tools.json');
const EXEC_TIMEOUT_MS = 10_000;

// Set up directories, package.json scope, and purge stale _exec/ files.
ensureToolEnv();

// ── Database setup ────────────────────────────────────────────────────────────

const db = new Database(DB_FILE, ...(SQLITE_BINDING ? [{ nativeBinding: SQLITE_BINDING }] : []));
db.pragma('journal_mode = WAL'); // safe concurrent reads

db.exec(`
  CREATE TABLE IF NOT EXISTS tools (
    name        TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    parameters  TEXT NOT NULL,
    created_at  TEXT NOT NULL
  )
`);

// Add runtime column if this is an existing database that predates the column.
try {
  db.exec(`ALTER TABLE tools ADD COLUMN runtime TEXT NOT NULL DEFAULT 'backend'`);
} catch { /* column already exists — safe to ignore */ }

const _list   = db.prepare('SELECT * FROM tools ORDER BY created_at');
const _get    = db.prepare('SELECT * FROM tools WHERE name = ?');
const _upsert = db.prepare(`
  INSERT INTO tools (name, description, parameters, runtime, created_at)
  VALUES (@name, @description, @parameters, @runtime, @created_at)
  ON CONFLICT(name) DO UPDATE SET
    description = excluded.description,
    parameters  = excluded.parameters,
    runtime     = excluded.runtime
`);
const _delete = db.prepare('DELETE FROM tools WHERE name = ?');

// ── Script-file helpers ───────────────────────────────────────────────────────

function scriptPath(name) {
  return join(SCRIPTS_DIR, `${name}.js`);
}

/**
 * Write a complete Node.js 22 ESM module to `tool-scripts/<name>.js`.
 * The module must export `async function run(args)`.
 */
function writeScript(name, description, implementation) {
  const header =
    `// Tool: ${name}\n` +
    `// ${description}\n` +
    `// Node.js 22 ESM module — must export async function run(args)\n\n`;
  writeFileSync(scriptPath(name), header + implementation, 'utf8');
}

/** Read the full contents of `tool-scripts/<name>.js`. */
function readScript(name) {
  return readFileSync(scriptPath(name), 'utf8');
}

// ── Row → ToolEntry ───────────────────────────────────────────────────────────

function toEntry(row) {
  return {
    name:        row.name,
    description: row.description,
    parameters:  JSON.parse(row.parameters),
    runtime:     row.runtime ?? 'backend',
    createdAt:   row.created_at,
    // Lazily read the implementation — callers that only need metadata don't pay the I/O.
    get implementation() { return readScript(row.name); },
  };
}

// ── Legacy migration ──────────────────────────────────────────────────────────

if (existsSync(LEGACY_JSON)) {
  try {
    const entries = JSON.parse(readFileSync(LEGACY_JSON, 'utf8'));
    db.transaction((rows) => {
      for (const e of rows) {
        _upsert.run({
          name:        e.name,
          description: e.description,
          parameters:  JSON.stringify(e.parameters ?? {}),
          runtime:     e.runtime ?? 'backend',
          created_at:  e.createdAt ?? new Date().toISOString(),
        });
        writeScript(e.name, e.description, e.implementation ?? '');
      }
    })(entries);
    renameSync(LEGACY_JSON, LEGACY_JSON + '.migrated');
    console.log(`[store] migrated ${entries.length} tool(s) from tools.json → SQLite`);
  } catch (err) {
    console.warn('[store] tools.json migration failed:', err.message);
  }
}

const toolCount = db.prepare('SELECT COUNT(*) AS n FROM tools').get().n;
console.log(`[store] SQLite ready — ${toolCount} tool(s)  (${DB_FILE})`);

// ── Public API ────────────────────────────────────────────────────────────────

export function listTools() {
  return _list.all().map(toEntry);
}

export function getTool(name) {
  const row = _get.get(name);
  return row ? toEntry(row) : undefined;
}

export function upsertTool({ name, description, parameters, implementation, runtime = 'backend' }) {
  _upsert.run({
    name,
    description,
    parameters:  JSON.stringify(parameters ?? {}),
    runtime,
    created_at:  new Date().toISOString(),
  });
  writeScript(name, description, implementation);
}

/** Returns true if the tool existed and was removed. */
export function removeTool(name) {
  const changed = _delete.run(name).changes > 0;
  if (changed) {
    try { unlinkSync(scriptPath(name)); } catch { /* already gone */ }
  }
  return changed;
}

// ── Module-import helpers ─────────────────────────────────────────────────────

/**
 * Scan `source` for `'#modules/<name>'` or `"#modules/<name>"` import specifiers.
 * Returns an array of unique module names referenced (e.g. ["string-utils", "http-client"]).
 */
function extractModuleRefs(source) {
  const seen = new Set();
  for (const [, name] of source.matchAll(/['"]#modules\/([a-z][a-z0-9-]*)['"],?/g)) {
    seen.add(name);
  }
  return [...seen];
}

/**
 * Replace every `'#modules/<name>'` / `"#modules/<name>"` occurrence in `source`
 * with the corresponding temp-copy relative path so the Node.js ESM cache sees
 * a unique URL per execution and never returns a stale module.
 *
 * @param {string} source  Original tool script source.
 * @param {Map<string,string>} nameToRel  name → relative path from TOOL_EXEC_DIR.
 */
function rewriteModuleImports(source, nameToRel) {
  return source.replace(
    /(['"])#modules\/([a-z][a-z0-9-]*)\1/g,
    (_, q, name) => {
      const rel = nameToRel.get(name);
      return rel ? `${q}./${rel}${q}` : `${q}#modules/${name}${q}`; // keep unknown refs as-is
    },
  );
}

// ── Executor ──────────────────────────────────────────────────────────────────

/**
 * Execute the named backend tool as a Node.js ESM module.
 *
 * How cache-busting works
 * ───────────────────────
 * Every invocation gets a UUID suffix so the same source never re-uses a cached
 * module instance:
 *   • Tool script  → _exec/<name>_<uuid>.mjs
 *   • Each #modules/<dep> → _exec/_mod_<dep>_<uuid>.mjs  (same UUID per run)
 *
 * '#modules/<name>' imports in the tool source are rewritten to relative paths
 * pointing at those temp copies before the file is written to disk.  npm imports
 * (e.g. `import axios from 'axios'`) resolve naturally through the package scope
 * rooted at data/tool-scripts/package.json.
 *
 * All temp files are deleted in .finally() regardless of success or timeout.
 *
 * Error enrichment
 * ────────────────
 * ERR_MODULE_NOT_FOUND → "Module '<name>' not found — run create_module first"
 * SyntaxError          → "Syntax error in tool '<name>': <details>"
 * ERR_PACKAGE_IMPORT_NOT_DEFINED → "#modules/<name> is not installed — run create_module first"
 */
export async function executeTool(name, args, context = {}) {
  const entry = getTool(name);
  if (entry?.runtime === 'frontend') {
    throw new Error(`Tool "${name}" is a frontend tool and must be executed in the browser, not on the server.`);
  }

  const uuid   = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpFiles = [];

  try {
    let source = readScript(name);

    // ── Write temp copies of every referenced #modules/<name> ────────────────
    const moduleNames = extractModuleRefs(source);
    const nameToRel   = new Map();

    for (const modName of moduleNames) {
      const modSrc  = join(TOOL_MODULES_DIR, `${modName}.mjs`);
      if (!existsSync(modSrc)) {
        throw Object.assign(
          new Error(`Module "${modName}" not found at ${modSrc} — run create_module first or check the spelling`),
          { code: 'ERR_TOOL_MODULE_NOT_FOUND' },
        );
      }
      const relName = `_mod_${modName}_${uuid}.mjs`;
      writeFileSync(join(TOOL_EXEC_DIR, relName), readFileSync(modSrc, 'utf8'), 'utf8');
      tmpFiles.push(join(TOOL_EXEC_DIR, relName));
      nameToRel.set(modName, relName);
    }

    // ── Rewrite #modules/* imports → relative temp-copy paths ────────────────
    if (nameToRel.size > 0) {
      source = rewriteModuleImports(source, nameToRel);
    }

    // ── Write the (possibly rewritten) tool script to _exec/ ─────────────────
    const toolTmp = join(TOOL_EXEC_DIR, `${name}_${uuid}.mjs`);
    writeFileSync(toolTmp, source, 'utf8');
    tmpFiles.push(toolTmp);

    // ── Import + execute ──────────────────────────────────────────────────────
    const execPromise = import(pathToFileURL(toolTmp).href)
      .then((mod) => {
        if (typeof mod.run !== 'function') {
          throw new Error(
            `Tool "${name}" must export \`async function run(args, context)\` — ` +
            `got: ${Object.keys(mod).join(', ') || '(no exports)'}`,
          );
        }
        return mod.run(args, context);
      })
      .catch((err) => {
        // Enrich common Node.js ESM resolution errors with actionable messages.
        if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_PACKAGE_IMPORT_NOT_DEFINED') {
          const missing = err.message.match(/Cannot find (?:module|package) '([^']+)'/)?.[1]
            ?? err.message.match(/Package import specifier "([^"]+)"/)?.[1]
            ?? '?';
          throw new Error(
            `Import resolution failed in tool "${name}": ${missing}\n` +
            `  • If this is a shared module:  run create_module to create it first\n` +
            `  • If this is an npm package:   run install_tool_deps(["${missing}"])`,
          );
        }
        if (err instanceof SyntaxError) {
          throw new Error(`Syntax error in tool "${name}":\n  ${err.message}`);
        }
        throw err;
      });

    return await Promise.race([
      execPromise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool "${name}" execution timed out after ${EXEC_TIMEOUT_MS / 1000}s`)),
          EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
  } finally {
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch { /* already gone — ok */ }
    }
  }
}

