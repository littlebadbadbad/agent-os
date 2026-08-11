/**
 * internal-apps/dynamic-tool/backend/lib/moduleStore.js — Shared module persistence
 */

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

export function createModuleStore(dataDir, toolEnv) {
  const DB_FILE = join(dataDir, 'tools.db');
  const MODULES_DIR = toolEnv.TOOL_MODULES_DIR;

  // Native binding lives alongside the compiled bundle (copied by build.mjs).
  let SQLITE_BINDING = null;
  try {
    const local = join(__dirname, 'better_sqlite3.node');
    if (existsSync(local)) SQLITE_BINDING = local;
  } catch {}

  const db = new Database(DB_FILE, ...(SQLITE_BINDING ? [{ nativeBinding: SQLITE_BINDING }] : []));

  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_modules (
      name        TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);

  const _list   = db.prepare('SELECT name, description, created_at, updated_at FROM tool_modules ORDER BY name');
  const _get    = db.prepare('SELECT name, description, created_at, updated_at FROM tool_modules WHERE name = ?');
  const _upsert = db.prepare(`
    INSERT INTO tool_modules (name, description, created_at, updated_at)
    VALUES (@name, @description, @now, @now)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      updated_at  = excluded.updated_at
  `);
  const _delete = db.prepare('DELETE FROM tool_modules WHERE name = ?');

  function modulePath(name) {
    return join(MODULES_DIR, `${name}.mjs`);
  }

  function toEntry(row, withContent = false) {
    const entry = {
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (withContent) {
      const mjsPath = modulePath(row.name);
      entry.content = existsSync(mjsPath) ? readFileSync(mjsPath, 'utf-8') : '';
    }
    return entry;
  }

  function listModules() {
    const rows = _list.all();
    return rows.map((r) => toEntry(r, false));
  }

  function getModule(name) {
    const row = _get.get(name);
    if (!row) return undefined;
    return toEntry(row, true);
  }

  function upsertModule({ name, description, content, language }) {
    const now = new Date().toISOString();
    _upsert.run({ name, description, now });
    if (content !== undefined) {
      writeFileSync(modulePath(name), content, 'utf-8');
    }
  }

  function removeModule(name) {
    const result = _delete.run(name);
    try { unlinkSync(modulePath(name)); } catch { /* file may not exist */ }
    return result.changes > 0;
  }

  return { listModules, getModule, upsertModule, removeModule };
}
