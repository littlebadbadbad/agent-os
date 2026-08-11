/**
 * agent-UI/app/core/sessions.ts — Super built-in "sessions" app API
 *
 * Typed wrappers around session persistence backend API.
 * All calls go through AppApiClient (dual HTTP/IPC transport).
 */

import { createAppApiClient } from '../apiClient';
import type { SessionEntryData } from '@agent-sdk';

const client = createAppApiClient('sessions');

export async function loadSessions(agentId: string): Promise<SessionEntryData[]> {
  try {
    const res = await client.call<{ sessions: SessionEntryData[] }>('load', { agentId });
    return Array.isArray(res.sessions) ? res.sessions : [];
  } catch {
    return [];
  }
}

export async function saveSessions(agentId: string, sessions: SessionEntryData[]): Promise<void> {
  try {
    await client.call('save', { agentId, sessions });
  } catch {
    // best-effort
  }
}
