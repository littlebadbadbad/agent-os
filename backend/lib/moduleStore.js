/**
 * backend/lib/moduleStore.js — Shared tool module persistence
 *
 * Stores module METADATA in SQLite (same tools.db used by store.js).
 * Stores module CONTENT as individual .mjs files under TOOL_MODULES_DIR
 * so they are diffable, inspectable, and importable by tool scripts.
 *
 * Module naming convention: kebab-case (e.g. "string-utils"), distinct
 * from tool names which use snake_case.
 *
 * Public API
 * ──────────
 *   listModules()                                → ModuleEntry[]
 *   getModule(name)                              → (ModuleEntry & { content }) | undefined
 *   upsertModule({ name, description, content }) → void
 *   removeModule(name)                           → boolean
 */

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { DATA_ROOT, SQLITE_BINDING } from './paths.js';
import { TOOL_MODULES_DIR } from './toolEnv.js';

const DB_FILE = join(DATA_ROOT, 'tools.db');
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

// ── File helpers ──────────────────────────────────────────────────────────────

function modulePath(name) {
  return join(TOOL_MODULES_DIR, `${name}.mjs`);
}

// ── Row → ModuleEntry ─────────────────────────────────────────────────────────

function toEntry(row, withContent = false) {
  const entry = {
    name:        row.name,
    description: row.description,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
  if (withContent) {
    const f = modulePath(row.name);
    entry.content = existsSync(f) ? readFileSync(f, 'utf8') : '';
  }
  return entry;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function listModules() {
  return _list.all().map(row => toEntry(row));
}

export function getModule(name) {
  const row = _get.get(name);
  return row ? toEntry(row, true) : undefined;
}

export function upsertModule({ name, description, content }) {
  const now = new Date().toISOString();
  _upsert.run({ name, description, now });
  writeFileSync(modulePath(name), content, 'utf8');
}

/** Returns true if the module existed and was removed. */
export function removeModule(name) {
  const changed = _delete.run(name).changes > 0;
  if (changed) {
    try { unlinkSync(modulePath(name)); } catch { /* already gone */ }
  }
  return changed;
}
