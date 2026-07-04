/**
 * Chat audit log route handlers.
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: parse HTTP request → call service → send HTTP response.
 */

import { send } from '../../lib/http.js';
import { queryLogs, fetchLog, fetchStats } from '../../services/chat-logs.js';

export async function handleChatLogRoutes(req, res, path) {
  // GET /api/chat-logs/stats ──────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/chat-logs/stats') {
    return send(res, 200, fetchStats());
  }

  // GET /api/chat-logs/:id ───────────────────────────────────────────────────
  if (req.method === 'GET' && path.startsWith('/api/chat-logs/')) {
    const id = decodeURIComponent(path.slice('/api/chat-logs/'.length));
    if (!id) return send(res, 400, { error: 'Missing log id' });
    const entry = fetchLog(id);
    if (!entry) return send(res, 404, { error: `Log "${id}" not found` });
    return send(res, 200, entry);
  }

  // GET /api/chat-logs ────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/chat-logs') {
    const url = new URL(req.url, 'http://localhost');
    const result = queryLogs({
      limit:     url.searchParams.get('limit'),
      offset:    url.searchParams.get('offset'),
      provider:  url.searchParams.get('provider'),
      mode:      url.searchParams.get('mode'),
      startTime: url.searchParams.get('start'),
      endTime:   url.searchParams.get('end'),
    });
    return send(res, 200, result);
  }

  return false;
}
