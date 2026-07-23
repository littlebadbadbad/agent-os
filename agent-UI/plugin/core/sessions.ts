/**
 * agent-UI/plugin/core/sessions.ts — Super built-in "sessions" plugin API
 *
 * Typed wrappers around session persistence backend API.
 * All calls go through PluginApiClient (dual HTTP/IPC transport).
 */

import { createPluginApiClient } from '../apiClient';
import type { SessionEntryData } from '@agent-sdk';

const client = createPluginApiClient('sessions');

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
