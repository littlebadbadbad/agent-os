/**
 * agent-UI/store/sessionStore.ts — Session persistence via apiTransport
 *
 * PURE BUSINESS LOGIC — ZERO direct fetch() calls.
 * Delegated to apiTransport (HTTP) / IPC-aware backend.
 */

import type { SessionEntryData } from '@agent-sdk';
import { apiTransport } from '../transport/apiTransport';

export async function loadSessions(agentId: string): Promise<SessionEntryData[]> {
  try {
    const res = await apiTransport.get<{ sessions: SessionEntryData[] }>(
      `/api/agent-sessions/${encodeURIComponent(agentId)}`,
    );
    return Array.isArray(res.sessions) ? res.sessions : [];
  } catch {
    return [];
  }
}

export async function saveSessions(agentId: string, sessions: SessionEntryData[]): Promise<void> {
  try {
    await apiTransport.put(
      `/api/agent-sessions/${encodeURIComponent(agentId)}`,
      { sessions },
    );
  } catch {
    // best-effort
  }
}
