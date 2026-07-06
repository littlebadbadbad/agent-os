/**
 * backend/lib/sessions.js — Shared session persistence
 *
 * Pure business-logic helpers consumed by both HTTP routes and IPC
 * transport.  No HTTP, no IPC, no transport concerns whatsoever.
 *
 * Exported surface:
 *   AGENT_ID_RE          → RegExp for validating agent IDs
 *   sessionsFile(id)     → absolute path to the JSON file for a given agent
 *   loadSessions(id)     → Promise<Array<object>> loaded from disk
 *   saveSessions(id,[])  → Promise<void>
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { DATA_ROOT } from './paths.js';

/** Regex that ensures agentId can never escape DATA_ROOT via path traversal. */
export const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** @param {string} agentId */
function sessionsFile(agentId) {
  return join(DATA_ROOT, `sessions-${agentId}.json`);
}

/**
 * Load saved sessions for a given agent from disk.
 * @param {string} agentId
 * @returns {Array<object>}
 * @throws {Error} if agentId is invalid or file parsing fails
 */
export function loadSessions(agentId) {
  if (!AGENT_ID_RE.test(agentId)) throw new Error('Invalid agentId');
  const file = sessionsFile(agentId);
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

/**
 * Persist sessions for a given agent to disk using atomic write-then-rename.
 *
 * Writes to a temporary file first, then renames it over the target.  This
 * prevents corruption when the process is killed mid-write — the target file
 * is always either the previous valid state or the complete new state, never
 * a half-written JSON blob.
 *
 * @param {string} agentId
 * @param {object[]} sessions
 * @throws {Error} if agentId is invalid
 */
export function saveSessions(agentId, sessions) {
  if (!AGENT_ID_RE.test(agentId)) throw new Error('Invalid agentId');
  const target = sessionsFile(agentId);
  const tmp = target + '.tmp';

  // Ensure the data directory exists (first-write guard).
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Remove a stale .tmp file from a previous interrupted write.
  try { unlinkSync(tmp); } catch {}

  writeFileSync(tmp, JSON.stringify(sessions), 'utf8');
  renameSync(tmp, target);
}
