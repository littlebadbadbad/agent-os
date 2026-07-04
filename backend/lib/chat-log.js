/**
 * Chat audit log — SQLite-backed persistence for every AI chat request.
 *
 * Layout:
 *   backend/chat-logs.db — SQLite database
 *
 * Every call to /api/chat or /api/chat/stream is recorded with:
 *   - request metadata (provider, mode, tool count, message count)
 *   - full request messages (JSON)
 *   - full response (JSON)
 *   - timing (duration_ms)
 *   - error info (if any)
 *
 * Public API:
 *   logChat({ ... })                     → id
 *   listLogs({ limit, offset, provider, mode, startTime, endTime })  → LogEntry[]
 *   getLog(id)                           → LogEntry | undefined
 *   getStats()                           → { total, byProvider, byMode, ... }
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DATA_ROOT, SQLITE_BINDING } from './paths.js';

const DB_FILE = join(DATA_ROOT, 'chat-logs.db');

// ── Database setup ────────────────────────────────────────────────

const db = new Database(DB_FILE, ...(SQLITE_BINDING ? [{ nativeBinding: SQLITE_BINDING }] : []));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_logs (
    id            TEXT PRIMARY KEY,
    provider      TEXT NOT NULL,
    mode          TEXT NOT NULL CHECK(mode IN ('async', 'stream')),
    message_count INTEGER NOT NULL,
    tool_count    INTEGER NOT NULL,
    tool_choice   TEXT,
    request_messages TEXT NOT NULL,
    system_prompt TEXT,
    response_text TEXT,
    response_tool_calls TEXT,
    error         TEXT,
    duration_ms   INTEGER,
    created_at    TEXT NOT NULL
  )
`);

// Indexes for common audit queries
db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_logs_created  ON chat_logs(created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_logs_provider ON chat_logs(provider)`);

// ── Prepared statements ───────────────────────────────────────────────────────

const _insert = db.prepare(`
  INSERT INTO chat_logs
    (id, provider, mode, message_count, tool_count, tool_choice,
     request_messages, system_prompt, response_text, response_tool_calls,
     error, duration_ms, created_at)
  VALUES
    (@id, @provider, @mode, @message_count, @tool_count, @tool_choice,
     @request_messages, @system_prompt, @response_text, @response_tool_calls,
     @error, @duration_ms, @created_at)
`);

const _getById = db.prepare('SELECT * FROM chat_logs WHERE id = ?');
const _count   = db.prepare('SELECT COUNT(*) AS total FROM chat_logs');

// ── Row mapper ────────────────────────────────────────────────────────────────

function toEntry(row) {
  return {
    id:               row.id,
    provider:         row.provider,
    mode:             row.mode,
    messageCount:     row.message_count,
    toolCount:        row.tool_count,
    toolChoice:       row.tool_choice,
    requestMessages:  JSON.parse(row.request_messages),
    systemPrompt:     row.system_prompt,
    responseText:     row.response_text,
    responseToolCalls: row.response_tool_calls ? JSON.parse(row.response_tool_calls) : null,
    error:            row.error,
    durationMs:       row.duration_ms,
    createdAt:        row.created_at,
  };
}

/** Lighter representation for list views (no full messages). */
function toSummary(row) {
  return {
    id:           row.id,
    provider:     row.provider,
    mode:         row.mode,
    messageCount: row.message_count,
    toolCount:    row.tool_count,
    durationMs:   row.duration_ms,
    error:        row.error || null,
    createdAt:    row.created_at,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a chat request/response pair.
 * Returns the generated log ID.
 */
export function logChat({
  provider,
  mode,
  messages,
  tools,
  toolChoice,
  systemPrompt,
  responseText,
  responseToolCalls,
  error,
  durationMs,
}) {
  const id = randomUUID();
  _insert.run({
    id,
    provider:           provider ?? 'unknown',
    mode,
    message_count:      Array.isArray(messages) ? messages.length : 0,
    tool_count:         Array.isArray(tools) ? tools.length : 0,
    tool_choice:        toolChoice ?? null,
    request_messages:   JSON.stringify(messages ?? []),
    system_prompt:      systemPrompt ?? null,
    response_text:      responseText ?? null,
    response_tool_calls: responseToolCalls ? JSON.stringify(responseToolCalls) : null,
    error:              error ?? null,
    duration_ms:        durationMs ?? null,
    created_at:         new Date().toISOString(),
  });
  return id;
}

/**
 * List audit logs with filtering and pagination.
 */
export function listLogs({ limit = 50, offset = 0, provider, mode, startTime, endTime } = {}) {
  const conditions = [];
  const params = {};

  if (provider) {
    conditions.push('provider = @provider');
    params.provider = provider;
  }
  if (mode) {
    conditions.push('mode = @mode');
    params.mode = mode;
  }
  if (startTime) {
    conditions.push('created_at >= @startTime');
    params.startTime = startTime;
  }
  if (endTime) {
    conditions.push('created_at <= @endTime');
    params.endTime = endTime;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countStmt = db.prepare(`SELECT COUNT(*) AS total FROM chat_logs ${where}`);
  const total = countStmt.get(params).total;

  const listStmt = db.prepare(
    `SELECT * FROM chat_logs ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`
  );
  const rows = listStmt.all({ ...params, limit, offset });

  return { total, logs: rows.map(toSummary) };
}

/**
 * Get a single log entry by ID, including full request/response data.
 */
export function getLog(id) {
  const row = _getById.get(id);
  return row ? toEntry(row) : undefined;
}

/**
 * Aggregate statistics for the audit dashboard.
 */
export function getStats() {
  const total = _count.get().total;
  const byProvider = db.prepare(
    'SELECT provider, COUNT(*) AS count FROM chat_logs GROUP BY provider ORDER BY count DESC'
  ).all();
  const byMode = db.prepare(
    'SELECT mode, COUNT(*) AS count FROM chat_logs GROUP BY mode'
  ).all();
  const errorCount = db.prepare(
    'SELECT COUNT(*) AS count FROM chat_logs WHERE error IS NOT NULL'
  ).get().count;
  const avgDuration = db.prepare(
    'SELECT AVG(duration_ms) AS avg FROM chat_logs WHERE duration_ms IS NOT NULL'
  ).get().avg;
  const recentActivity = db.prepare(
    `SELECT DATE(created_at) AS date, COUNT(*) AS count
     FROM chat_logs
     GROUP BY DATE(created_at)
     ORDER BY date DESC
     LIMIT 30`
  ).all();

  return {
    total,
    errorCount,
    avgDurationMs: avgDuration ? Math.round(avgDuration) : null,
    byProvider,
    byMode,
    recentActivity,
  };
}

const logCount = db.prepare('SELECT COUNT(*) AS n FROM chat_logs').get().n;
console.log(`[chat-log] SQLite ready — ${logCount} log(s)  (${DB_FILE})`);
