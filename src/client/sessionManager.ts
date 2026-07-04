import type {
  SessionEntryData,
  SessionListEntry,
  SessionManagerState,
  SessionManager,
} from './sessionManager.types';
import type { AgentSession } from './agentSession.types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionFactory = (data: SessionEntryData) => AgentSession;

export type SessionManagerOptions = {
  /** Sessions to create on init (static). */
  initialSessions?: SessionEntryData[];
  /**
   * Called immediately before a session is removed from the manager.
   * Use to release any per-session resources held outside the session itself.
   */
  onRemoveSession?: (id: string) => void;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

let idCounter = 0;
function generateId(): string {
  return `session-${Date.now()}-${++idCounter}`;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSessionManager(
  sessionFactory: SessionFactory,
  options: SessionManagerOptions = {},
): SessionManager {
  const entries = new Map<string, SessionListEntry>();
  let order: string[] = [];
  let activeSessionId: string | undefined;
  const subscribers = new Set<() => void>();

  // Snapshot cached for useSyncExternalStore (reference-stable when nothing changes).
  let snapshot: SessionManagerState = { sessions: [], activeSessionId: undefined };

  function updateSnapshot(): void {
    snapshot = {
      sessions: order.map((id) => entries.get(id)!),
      activeSessionId,
    };
  }

  function getState(): SessionManagerState {
    return snapshot;
  }

  function notify(): void {
    updateSnapshot();
    for (const sub of subscribers) sub();
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  function addEntry(data: SessionEntryData): AgentSession {
    const session = sessionFactory(data);
    entries.set(data.id, { id: data.id, title: data.title, session });
    order.push(data.id);
    return session;
  }

  function pickFallbackActive(removedIndex: number): string | undefined {
    if (order.length === 0) return undefined;
    return order[Math.min(removedIndex, order.length - 1)];
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  function createSession(data: Partial<SessionEntryData> = {}): AgentSession {
    const id = data.id ?? generateId();
    const title = data.title ?? `Session ${order.length + 1}`;
    const session = addEntry({ ...data, id, title });
    activeSessionId = id;
    notify();
    return session;
  }

  function removeSession(id: string): void {
    if (!entries.has(id)) return;
    const prevIndex = order.indexOf(id);
    options.onRemoveSession?.(id);
    entries.delete(id);
    order = order.filter((i) => i !== id);
    if (activeSessionId === id) {
      activeSessionId = pickFallbackActive(prevIndex);
    }
    notify();
  }

  function setActiveSession(id: string): void {
    if (!entries.has(id) || activeSessionId === id) return;
    activeSessionId = id;
    notify();
  }

  function renameSession(id: string, title: string): void {
    const entry = entries.get(id);
    if (!entry || entry.title === title) return;
    entries.set(id, { ...entry, title });
    entry.session.setTitle(title);
    notify();
  }

  // ── Initialization ────────────────────────────────────────────────────────

  const initialData = options.initialSessions ?? [];
  for (const data of initialData) {
    addEntry(data);
  }

  if (order.length > 0) {
    activeSessionId = order[0];
  } else {
    // Always start with at least one session so the UI is never empty.
    const id = generateId();
    addEntry({ id, title: 'New Chat' });
    activeSessionId = id;
  }

  updateSnapshot();

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    getState,
    subscribe(fn: () => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    createSession,
    removeSession,
    setActiveSession,
    renameSession,
    getSession: (id) => entries.get(id)?.session,
    getActiveSession: () =>
      activeSessionId ? entries.get(activeSessionId)?.session : undefined,
  };
}
