/**
 * internal-apps/dynamic-tool/backend/lib/store.js — Tool persistence (SQLite + script files)
 *
 * storeTools(dataDir, toolEnv) creates a store bound to the given data directory.
 */

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const EXEC_TIMEOUT_MS = 10_000;

export function createToolStore(dataDir, toolEnv) {
  const DB_FILE = join(dataDir, 'tools.db');
  const SCRIPTS_DIR = toolEnv.TOOL_SCRIPTS_DIR;
  const EXEC_DIR = toolEnv.TOOL_EXEC_DIR;

  // Native binding lives alongside the compiled bundle (copied by build.mjs).
  let SQLITE_BINDING = null;
  try {
    const local = join(__dirname, 'better_sqlite3.node');
    if (existsSync(local)) SQLITE_BINDING = local;
  } catch {}

  toolEnv.ensureToolEnv();

  const db = new Database(DB_FILE, ...(SQLITE_BINDING ? [{ nativeBinding: SQLITE_BINDING }] : []));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tools (
      name        TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      parameters  TEXT NOT NULL,
      implementation TEXT NOT NULL,
      runtime     TEXT NOT NULL DEFAULT 'backend',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);

  const _list   = db.prepare('SELECT * FROM tools ORDER BY name');
  const _get    = db.prepare('SELECT * FROM tools WHERE name = ?');
  const _upsert = db.prepare(`
    INSERT INTO tools (name, description, parameters, implementation, runtime, created_at, updated_at)
    VALUES (@name, @description, @parameters, @implementation, @runtime, @now, @now)
    ON CONFLICT(name) DO UPDATE SET
      description    = excluded.description,
      parameters     = excluded.parameters,
      implementation = excluded.implementation,
      runtime        = excluded.runtime,
      updated_at     = excluded.updated_at
  `);
  const _delete = db.prepare('DELETE FROM tools WHERE name = ?');

  function migrateLegacyJson() {
    const LEGACY_JSON = join(dataDir, 'tools.json');
    if (!existsSync(LEGACY_JSON)) return;
    try {
      const legacy = JSON.parse(readFileSync(LEGACY_JSON, 'utf-8'));
      if (Array.isArray(legacy)) {
        const insert = db.prepare(`
          INSERT OR IGNORE INTO tools (name, description, parameters, implementation, runtime, created_at, updated_at)
          VALUES (@name, @description, @parameters, @implementation, @runtime, @now, @now)
        `);
        const now = new Date().toISOString();
        const migrate = db.transaction(() => {
          for (const t of legacy) {
            insert.run({
              name: t.name,
              description: t.description ?? '',
              parameters: JSON.stringify(t.parameters ?? { type: 'object', properties: {} }),
              implementation: t.implementation ?? t.code ?? '',
              runtime: t.runtime ?? 'backend',
              now,
            });
          }
        });
        migrate();
      }
      renameSync(LEGACY_JSON, LEGACY_JSON + '.migrated');
      console.log(`[store] migrated ${legacy.length} legacy tools from tools.json`);
    } catch (err) {
      console.warn('[store] legacy migration failed:', err.message);
    }
  }

  migrateLegacyJson();

  function listTools() {
    return _list.all().map(rowToEntry);
  }

  function getTool(name) {
    const row = _get.get(name);
    return row ? rowToEntry(row) : undefined;
  }

  function upsertTool({ name, description, parameters, implementation, runtime }) {
    const now = new Date().toISOString();
    _upsert.run({
      name, description,
      parameters: JSON.stringify(parameters ?? { type: 'object', properties: {} }),
      implementation: implementation ?? '',
      runtime: runtime ?? 'backend',
      now,
    });
  }

  function removeTool(name) {
    const result = _delete.run(name);
    return result.changes > 0;
  }

  async function executeTool(name, args, ctx = {}) {
    const entry = getTool(name);
    if (!entry) throw new Error(`Tool "${name}" not found`);
    if (entry.runtime === 'frontend') throw new Error(`Tool "${name}" is a frontend tool`);

    const scriptPath = join(EXEC_DIR, `${name}_${Date.now()}.mjs`);
    try {
      let source = entry.implementation;
      source = source.replace(/from\s+['"](\$var:[^'"]+)['"]/g, (m, handle) => {
        const val = ctx[handle];
        return `from '${JSON.stringify(val ?? handle)}'`;
      });
      writeFileSync(scriptPath, source, 'utf-8');

      const toolUrl = pathToFileURL(scriptPath).href;
      const mod = await import(toolUrl);
      if (typeof mod.run !== 'function') {
        throw new Error(`Tool "${name}" does not export an async run(args, context) function`);
      }
      return await mod.run(args ?? {}, ctx);
    } finally {
      try { unlinkSync(scriptPath); } catch { /* ok */ }
    }
  }

  function rowToEntry(row) {
    return {
      name: row.name,
      description: row.description,
      parameters: typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters,
      implementation: row.implementation,
      runtime: row.runtime,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return { listTools, getTool, upsertTool, removeTool, executeTool };
}
