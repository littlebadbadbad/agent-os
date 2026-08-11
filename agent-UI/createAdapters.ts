/**
 * agent-UI/createAdapters.ts — Environment-aware adapter factories
 *
 * File, Git, and Dynamic-Tool adapters are now provided via the app system.
 * Each app creates its own adapter from the pre-bound AppApiClient,
 * so direct adapter factories are no longer needed here.
 */

import { IS_ELECTRON_IPC } from './env';

// ── Session store ──────────────────────────────────────────────────────────────
import type { SessionEntryData } from '@agent-sdk';
import { loadSessions, saveSessions } from './api/backend';

export type SessionStore = {
  loadSessions(agentId: string): Promise<SessionEntryData[]>;
  saveSessions(agentId: string, sessions: SessionEntryData[]): Promise<void>;
};

/** Session store backed by backend.ts (which auto-selects HTTP or IPC). */
export function createSessionStore(): SessionStore {
  return { loadSessions, saveSessions };
}

// ── Singleton instances ────────────────────────────────────────────────────────
// Created once at module load time, shared across all agents.

export const sessionStore = createSessionStore();
