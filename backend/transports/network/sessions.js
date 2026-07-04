/**
 * Session routes — PURE PROTOCOL LAYER.
 *
 * Only: extract params → call service → send result.
 * Zero business logic, zero validation, zero error formatting.
 */

import { readBody, send } from '../../lib/http.js';
import * as sessionService from '../../services/sessions.js';

export async function handleSessionRoutes(req, res, path) {
  const prefix = "/api/agent-sessions/";
  if (!path.startsWith(prefix)) return false;

  const agentId = decodeURIComponent(path.slice(prefix.length));

  if (req.method === "GET") {
    return send(res, 200, sessionService.loadAgentSessions({ agentId }));
  }

  if (req.method === "PUT") {
    const body = await readBody(req);
    return send(res, 200, sessionService.saveAgentSessions({ agentId, sessions: body.sessions }));
  }

  return false;
}
