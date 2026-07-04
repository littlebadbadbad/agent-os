/**
 * backend/lib/services/sessions.js — Session-persistence business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here.
 */

import { loadSessions, saveSessions, AGENT_ID_RE } from '../lib/sessions.js';

export function loadAgentSessions({ agentId }) {
  if (!agentId) throw new Error('agentId is required');
  if (!AGENT_ID_RE.test(agentId)) throw new Error('Invalid agentId');
  const sessions = loadSessions(agentId);
  return { sessions };
}

export function saveAgentSessions({ agentId, sessions }) {
  if (!agentId) throw new Error('agentId is required');
  if (!AGENT_ID_RE.test(agentId)) throw new Error('Invalid agentId');
  if (!Array.isArray(sessions)) throw new Error('sessions must be an array');
  saveSessions(agentId, sessions);
  return { ok: true };
}
