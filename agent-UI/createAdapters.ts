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

// ── Terminal adapter ───────────────────────────────────────────────────────────
import { createHttpTerminalAdapter, createIpcTerminalAdapter } from '@agent-sdk';
import type { TerminalManagerAdapter } from '@agent-sdk';

export function createTerminalAdapter(): TerminalManagerAdapter {
  return IS_ELECTRON_IPC
    ? createIpcTerminalAdapter()
    : createHttpTerminalAdapter({ baseUrl: '/api' });
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

// ── Skill adapter ──────────────────────────────────────────────────────────────
import { createHttpSkillAdapter, createIpcSkillAdapter } from '@agent-sdk';
import type { SkillManagerAdapter } from '@agent-sdk';

export function createSkillAdapter(): SkillManagerAdapter {
  return IS_ELECTRON_IPC
    ? createIpcSkillAdapter()
    : createHttpSkillAdapter({ baseUrl: '/api' });
}

// ── MCP adapter ────────────────────────────────────────────────────────────────
import { createHttpMcpAdapter, createIpcMcpAdapter } from '@agent-sdk';
import type { McpAdapter } from '@agent-sdk';

export function createMcpAdapter(): McpAdapter {
  return IS_ELECTRON_IPC
    ? createIpcMcpAdapter()
    : createHttpMcpAdapter({ baseUrl: '/api' });
}

// ── Upgrade adapter ────────────────────────────────────────────────────────────
import { createHttpUpgradeAdapter, createIpcUpgradeAdapter } from '@agent-sdk';
import type { UpgradeAdapter } from '@agent-sdk';

export function createUpgradeAdapter(): UpgradeAdapter {
  return IS_ELECTRON_IPC
    ? createIpcUpgradeAdapter()
    : createHttpUpgradeAdapter({ baseUrl: '/api' });
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
export const terminalAdapter = createTerminalAdapter();
export const cronAdapter = createCronAdapter();
export const dynamicToolAdapter = createDynamicToolAdapter();
export const skillAdapter = createSkillAdapter();
export const mcpAdapter = createMcpAdapter();
export const upgradeAdapter = createUpgradeAdapter();
export const sessionStore = createSessionStore();
