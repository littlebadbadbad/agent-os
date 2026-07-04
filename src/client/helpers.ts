import type { SessionManager } from './sessionManager.types';
import type { SessionEntryData } from './sessionManager.types';

// ── DOM helper ────────────────────────────────────────────────────────────────

let containerCount = 0;

/**
 * Create and append a uniquely-identified mount point to `document.body`.
 * Used as the default render target when no container is passed to `render()`.
 */
export function createDefaultContainer(): HTMLElement {
  const div = document.createElement('div');
  div.id = `agent-sdk-root-${++containerCount}`;
  document.body.appendChild(div);
  return div;
}

// ── Persistence wiring ────────────────────────────────────────────────────────

/**
 * Handle returned by `wireSessionPersistence`.
 *
 * `flush()` lets callers force any pending debounced write to land
 * synchronously — used by the upgrade ToolSet just before restarting the
 * server so that `pendingUserInput` is on disk before the process exits.
 */
export interface SessionPersistenceHandle {
  /** Cancel any pending debounce timer, fire the write immediately, and
   *  await the (possibly async) callback. Always resolves — never throws. */
  flush(): Promise<void>;
}

/**
 * Subscribe to a session manager and debounce snapshot saves so that
 * streaming tokens don't trigger a persistence write per chunk.
 *
 * The `onSessionsChange` callback may be sync or async; when async, its
 * returned promise is tracked so `flush()` can await an in-flight write.
 */
export function wireSessionPersistence(
  sessionMgr: SessionManager,
  onSessionsChange: (snapshots: SessionEntryData[], force?: boolean) => void | Promise<void>,
  buildSnapshot: (sessionId: string) => SessionEntryData,
): SessionPersistenceHandle {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // Tracks the most recent onSessionsChange invocation so flush() can wait for
  // an already-in-flight write to land instead of racing it.
  let inflight: Promise<void> | null = null;

  function doSave(force = false): void {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const { sessions } = sessionMgr.getState();
    const snapshots = sessions.flatMap((entry): SessionEntryData[] => {
      try {
        return [buildSnapshot(entry.id)];
      } catch {
        return [];
      }
    });
    let result: void | Promise<void>;
    try {
      result = force ? onSessionsChange(snapshots, true) : onSessionsChange(snapshots);
    } catch {
      result = undefined;
    }
    inflight = Promise.resolve(result)
      .catch(() => undefined)
      .then(() => { inflight = null; });
  }

  function scheduleSave(): void {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 200);
  }

  const sessionUnsubs = new Map<string, () => void>();

  function subscribeSession(id: string): void {
    if (sessionUnsubs.has(id)) return;
    const session = sessionMgr.getSession(id);
    if (!session) return;
    sessionUnsubs.set(id, session.subscribe(scheduleSave));
  }

  for (const entry of sessionMgr.getState().sessions) {
    subscribeSession(entry.id);
  }

  sessionMgr.subscribe(() => {
    const { sessions } = sessionMgr.getState();
    const currentIds = new Set(sessions.map((s) => s.id));
    for (const entry of sessions) subscribeSession(entry.id);
    for (const id of [...sessionUnsubs.keys()]) {
      if (!currentIds.has(id)) {
        sessionUnsubs.get(id)?.();
        sessionUnsubs.delete(id);
      }
    }
    scheduleSave();
  });

  return {
    async flush() {
      // Always force-save regardless of whether a debounce timer is pending.
      // Without this, flush() silently no-ops when the inner 200 ms timer has
      // already fired (saveTimer === null) but makeDebouncedSave's own 2 s
      // timer is still counting — causing upgrade_restart to exit the server
      // before the pending write lands on disk and the session snapshot is lost.
      doSave(true);
      if (inflight) await inflight;
    },
  };
}
