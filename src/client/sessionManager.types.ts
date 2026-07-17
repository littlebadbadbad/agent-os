import type { AgentSession } from './agentSession.types';
import type { SessionEntryData, SessionEntryDataBase } from '@agent-type';

// SessionEntryDataBase, SessionEntryExtension, and SessionEntryData are defined
// in @agent-type/core.ts. ToolSets contribute persisted fields via:
//   declare module '@agent-type' { interface SessionEntryExtension { ... } }

// Re-export for convenience — existing import paths remain valid.
export type { SessionEntryData, SessionEntryDataBase };

// ── Live entries ──────────────────────────────────────────────────────────────

export type SessionListEntry = {
  id: string;
  title: string;
  /** ISO timestamp of when this entry was created. */
  createdAt: string;
  session: AgentSession;
};

// ── State ─────────────────────────────────────────────────────────────────────

export type SessionManagerState = {
  sessions: SessionListEntry[];
  activeSessionId: string | undefined;
};

// ── Public interface ──────────────────────────────────────────────────────────

export type SessionManager = {
  getState(): SessionManagerState;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
  /** Create a new session and make it active. Returns the new AgentSession. */
  createSession(data?: Partial<SessionEntryData>): AgentSession;
  /** Remove a session by ID. If it was active, activates the nearest remaining session. */
  removeSession(id: string): void;
  /** Switch the active (visible) session. */
  setActiveSession(id: string): void;
  /** Rename a session in-place. */
  renameSession(id: string, title: string): void;
  /** Get a session by ID. */
  getSession(id: string): AgentSession | undefined;
  /** Get the currently active session (undefined only if all sessions were removed). */
  getActiveSession(): AgentSession | undefined;
};
