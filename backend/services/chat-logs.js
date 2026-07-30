/**
 * backend/lib/services/chat-logs.js — Chat audit log business API
 *
 * Wraps the low-level chat-log module with query-param parsing and
 * not-found semantics so that HTTP routes are pure protocol passthroughs.
 */

import { listLogs, getLog, getStats } from '../lib/chat-log.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('chat-logs-service');

/**
 * List chat logs with pagination and filtering.
 *
 * @param {object} params
 * @param {number} [params.limit]
 * @param {number} [params.offset]
 * @param {string} [params.provider]
 * @param {string} [params.mode]
 * @param {string} [params.startTime]
 * @param {string} [params.endTime]
 * @returns {{ logs: Array, total: number }}
 */
export function queryLogs(params = {}) {
  const normalised = {
    limit:     Number(params.limit) || 50,
    offset:    Number(params.offset) || 0,
    provider:  params.provider || undefined,
    mode:      params.mode || undefined,
    startTime: params.startTime || undefined,
    endTime:   params.endTime || undefined,
  };
  return listLogs(normalised);
}

/**
 * Get a single log entry by ID.
 *
 * @param {string} id
 * @returns {object|null} the log entry, or null if not found
 */
export function fetchLog(id) {
  if (!id) return null;
  return getLog(id) ?? null;
}

/**
 * Get aggregate statistics.
 *
 * @returns {object}
 */
export function fetchStats() {
  return getStats();
}
