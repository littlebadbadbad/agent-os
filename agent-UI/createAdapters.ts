/**
 * agent-UI/createAdapters.ts — Environment-aware adapter factories
 *
 * Detects the runtime environment (Electron IPC vs standalone HTTP) and
 * creates the appropriate adapters for every backend service.
 *
 * All HTTP adapters use `baseUrl: '/api'` (proxied by Vite in dev, same-origin
 * in production).  All IPC adapters use `window.electronAPI.invoke()`.
 */

import { IS_ELECTRON_IPC } from './env';

// ── File adapter ───────────────────────────────────────────────────────────────
import { createHttpFileAdapter, createIpcFileAdapter } from '@agent-sdk';
import type { FileAdapter } from '@agent-sdk';

export function createFileAdapter(): FileAdapter {
  return IS_ELECTRON_IPC
    ? createIpcFileAdapter()
    : createHttpFileAdapter({ baseUrl: '' });
}

// ── Cron adapter ───────────────────────────────────────────────────────────────
import { createHttpCronAdapter, createIpcCronAdapter } from '@agent-sdk';
import type { CronManagerAdapter } from '@agent-sdk';

export function createCronAdapter(): CronManagerAdapter {
  return IS_ELECTRON_IPC
    ? createIpcCronAdapter()
    : createHttpCronAdapter({ baseUrl: '/api' });
}

// ── Dynamic tool adapter ───────────────────────────────────────────────────────
import { createHttpDynamicToolAdapter, createIpcDynamicToolAdapter } from '@agent-sdk';
import type { DynamicToolAdapter } from '@agent-sdk';

export function createDynamicToolAdapter(): DynamicToolAdapter {
  return IS_ELECTRON_IPC
    ? createIpcDynamicToolAdapter()
    : createHttpDynamicToolAdapter({ baseUrl: '/api' });
}

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

export const fileAdapter = createFileAdapter();
export const cronAdapter = createCronAdapter();
export const dynamicToolAdapter = createDynamicToolAdapter();
export const sessionStore = createSessionStore();
