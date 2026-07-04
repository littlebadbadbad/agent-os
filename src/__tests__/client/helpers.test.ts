import { describe, it, expect, vi, afterEach } from 'vitest';
import { wireSessionPersistence, createDefaultContainer } from '../../client/helpers';
import type { SessionManager } from '../../client/sessionManager.types';
import type { SessionEntryData } from '../../client/sessionManager.types';
import type { AgentSession } from '../../client/agentSession.types';

// ── createDefaultContainer ──────────────────────────────────────────────────

describe('createDefaultContainer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a div with a unique id and appends it to document.body', () => {
    const appended: unknown[] = [];
    const mockDiv = { id: '' };
    const mockDocument = {
      createElement: vi.fn(() => mockDiv),
      body: { appendChild: vi.fn((el: unknown) => { appended.push(el); }) },
    };
    vi.stubGlobal('document', mockDocument);

    const result = createDefaultContainer();

    expect(mockDocument.createElement).toHaveBeenCalledWith('div');
    expect(mockDocument.body.appendChild).toHaveBeenCalledWith(mockDiv);
    expect(result.id).toMatch(/^agent-sdk-root-\d+$/);
  });

  it('increments the id counter on each call', () => {
    let divCount = 0;
    const divs: Array<{ id: string }> = [];
    const mockDocument = {
      createElement: vi.fn(() => { const d = { id: '' }; divs.push(d); divCount++; return d; }),
      body: { appendChild: vi.fn() },
    };
    vi.stubGlobal('document', mockDocument);

    const first = createDefaultContainer();
    const second = createDefaultContainer();

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^agent-sdk-root-\d+$/);
    expect(second.id).toMatch(/^agent-sdk-root-\d+$/);
  });
});

// ── wireSessionPersistence ────────────────────────────────────────────────────

describe('wireSessionPersistence', () => {
  /**
   * Build a minimal SessionManager stub with controllable subscription.
   */
  function makeSessionMgr(sessions: { id: string; title: string }[]): {
    mgr: SessionManager;
    notifyMgr: () => void;
    notifySession: (id: string) => void;
  } {
    const sessionSubs = new Map<string, Set<() => void>>();
    const mgrSubs = new Set<() => void>();

    const sessionObjs = new Map<string, AgentSession>(
      sessions.map(({ id }) => {
        const subs = new Set<() => void>();
        sessionSubs.set(id, subs);
        const session: Partial<AgentSession> = {
          subscribe: (fn: () => void) => { subs.add(fn); return () => subs.delete(fn); },
        };
        return [id, session as AgentSession];
      }),
    );

    const mgr: SessionManager = {
      getState: () => ({
        sessions: sessions.map((s) => ({ id: s.id, title: s.title, session: sessionObjs.get(s.id)! })),
        activeSessionId: sessions[0]?.id,
      }),
      subscribe: (fn: () => void) => { mgrSubs.add(fn); return () => mgrSubs.delete(fn); },
      createSession: vi.fn(),
      removeSession: vi.fn(),
      setActiveSession: vi.fn(),
      renameSession: vi.fn(),
      getSession: (id: string) => sessionObjs.get(id),
      getActiveSession: () => sessionObjs.get(sessions[0]?.id ?? '') ?? undefined,
    };

    return {
      mgr,
      notifyMgr: () => mgrSubs.forEach((fn) => fn()),
      notifySession: (id: string) => sessionSubs.get(id)?.forEach((fn) => fn()),
    };
  }

  it('calls onSessionsChange after a debounced session change', async () => {
    const { mgr, notifySession } = makeSessionMgr([{ id: 's1', title: 'S1' }]);
    const onSessionsChange = vi.fn();
    const buildSnapshot = vi.fn((id: string): SessionEntryData => ({ id, title: 'T' }));

    wireSessionPersistence(mgr, onSessionsChange, buildSnapshot);

    notifySession('s1');

    // Should not have been called synchronously (debounced at 500 ms)
    expect(onSessionsChange).not.toHaveBeenCalled();

    // Advance fake timers
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    expect(onSessionsChange).toHaveBeenCalledTimes(1);
    expect(onSessionsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 's1' })]),
    );
  });

  it('debounces multiple rapid changes into a single call', async () => {
    const { mgr, notifySession } = makeSessionMgr([{ id: 's1', title: 'S1' }]);
    const onSessionsChange = vi.fn();
    const buildSnapshot = vi.fn((id: string): SessionEntryData => ({ id, title: 'T' }));

    wireSessionPersistence(mgr, onSessionsChange, buildSnapshot);

    notifySession('s1');
    notifySession('s1');
    notifySession('s1');

    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    expect(onSessionsChange).toHaveBeenCalledTimes(1);
  });

  it('gracefully handles buildSnapshot errors (skips the failing session)', async () => {
    const { mgr, notifySession } = makeSessionMgr([{ id: 's1', title: 'S1' }]);
    const onSessionsChange = vi.fn();
    const buildSnapshot = vi.fn((id: string): SessionEntryData => {
      if (id === 's1') throw new Error('snapshot error');
      return { id, title: 'T' };
    });

    wireSessionPersistence(mgr, onSessionsChange, buildSnapshot);
    notifySession('s1');

    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    // Should still call onSessionsChange even on snapshot error
    expect(onSessionsChange).toHaveBeenCalledTimes(1);
  });

  it('subscribes to new sessions added after initialization', async () => {
    // Tests the subscribeSession call inside the sessionMgr.subscribe() callback
    const mgrSubs = new Set<() => void>();
    const sessionSubs = new Map<string, Set<() => void>>();

    // Start with s1
    const s1Subs = new Set<() => void>();
    sessionSubs.set('s1', s1Subs);
    const s1: Partial<AgentSession> = {
      subscribe: (fn: () => void) => { s1Subs.add(fn); return () => s1Subs.delete(fn); },
    };

    // s2 will be added after initialization
    const s2Subs = new Set<() => void>();
    sessionSubs.set('s2', s2Subs);
    const s2: Partial<AgentSession> = {
      subscribe: (fn: () => void) => { s2Subs.add(fn); return () => s2Subs.delete(fn); },
    };

    let sessions = [{ id: 's1', title: 'S1' }];

    const mgr: SessionManager = {
      getState: () => ({
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          session: (s.id === 's1' ? s1 : s2) as AgentSession,
        })),
        activeSessionId: sessions[0]?.id,
      }),
      subscribe: (fn: () => void) => { mgrSubs.add(fn); return () => mgrSubs.delete(fn); },
      createSession: vi.fn(),
      removeSession: vi.fn(),
      setActiveSession: vi.fn(),
      renameSession: vi.fn(),
      getSession: (id: string) => (id === 's1' ? s1 : s2) as AgentSession,
      getActiveSession: () => s1 as AgentSession,
    };

    const onSessionsChange = vi.fn();
    const buildSnapshot = vi.fn((id: string): SessionEntryData => ({ id, title: 'T' }));

    wireSessionPersistence(mgr, onSessionsChange, buildSnapshot);

    // Now add s2 and notify the manager
    sessions = [{ id: 's1', title: 'S1' }, { id: 's2', title: 'S2' }];
    mgrSubs.forEach((fn) => fn()); // trigger manager subscriber

    // s2 was added; trigger s2 session change
    s2Subs.forEach((fn) => fn());

    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    expect(onSessionsChange).toHaveBeenCalled();
  });

  it('unsubscribes removed sessions', async () => {
    // Tests the cleanup of sessionUnsubs when a session is removed
    const mgrSubs = new Set<() => void>();
    const s1Subs = new Set<() => void>();

    const s1: Partial<AgentSession> = {
      subscribe: (fn: () => void) => { s1Subs.add(fn); return () => s1Subs.delete(fn); },
    };

    let sessions = [{ id: 's1', title: 'S1' }];

    const mgr: SessionManager = {
      getState: () => ({
        sessions: sessions.map((s) => ({ id: s.id, title: s.title, session: s1 as AgentSession })),
        activeSessionId: sessions[0]?.id,
      }),
      subscribe: (fn: () => void) => { mgrSubs.add(fn); return () => mgrSubs.delete(fn); },
      createSession: vi.fn(),
      removeSession: vi.fn(),
      setActiveSession: vi.fn(),
      renameSession: vi.fn(),
      getSession: () => s1 as AgentSession,
      getActiveSession: () => s1 as AgentSession,
    };

    const onSessionsChange = vi.fn();
    const buildSnapshot = vi.fn((id: string): SessionEntryData => ({ id, title: 'T' }));

    wireSessionPersistence(mgr, onSessionsChange, buildSnapshot);

    // Remove s1 from sessions and notify the manager
    sessions = [];
    mgrSubs.forEach((fn) => fn());

    // After removal, s1Subs should be empty (unsubscribed)
    expect(s1Subs.size).toBe(0);
  });

  it('subscribeSession skips when getSession returns undefined for an id in sessions', () => {
    // Covers the `if (!session) return` false branch (line 72 in helpers.ts)
    // This happens when getState().sessions has an entry but getSession() returns undefined
    const mgrSubs = new Set<() => void>();
    const mgr: SessionManager = {
      getState: () => ({
        sessions: [{ id: 'ghost', title: 'Ghost', session: {} as AgentSession }],
        activeSessionId: 'ghost',
      }),
      subscribe: (fn: () => void) => { mgrSubs.add(fn); return () => mgrSubs.delete(fn); },
      createSession: vi.fn(),
      removeSession: vi.fn(),
      setActiveSession: vi.fn(),
      renameSession: vi.fn(),
      // getSession returns undefined for 'ghost' — simulating a race condition
      getSession: () => undefined,
      getActiveSession: () => undefined,
    };

    const onSessionsChange = vi.fn();
    const buildSnapshot = vi.fn((id: string): SessionEntryData => ({ id, title: 'T' }));

    // Should not throw even though getSession returns undefined
    expect(() => wireSessionPersistence(mgr, onSessionsChange, buildSnapshot)).not.toThrow();
  });

  it('flush cancels pending debounce and calls onSessionsChange with force=true', async () => {
    const { mgr, notifySession } = makeSessionMgr([{ id: 's1', title: 'S1' }]);
    const onSessionsChange = vi.fn();
    const buildSnapshot = vi.fn((id: string): SessionEntryData => ({ id, title: 'T' }));

    const handle = wireSessionPersistence(mgr, onSessionsChange, buildSnapshot);

    notifySession('s1');
    // Debounce is pending — not yet fired
    expect(onSessionsChange).not.toHaveBeenCalled();

    await handle.flush();

    expect(onSessionsChange).toHaveBeenCalledTimes(1);
    expect(onSessionsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 's1' })]),
      true,
    );
  });

  it('normal debounced save does NOT pass force to onSessionsChange', async () => {
    const { mgr, notifySession } = makeSessionMgr([{ id: 's1', title: 'S1' }]);
    const onSessionsChange = vi.fn();
    const buildSnapshot = vi.fn((id: string): SessionEntryData => ({ id, title: 'T' }));

    wireSessionPersistence(mgr, onSessionsChange, buildSnapshot);

    notifySession('s1');
    await new Promise<void>((resolve) => setTimeout(resolve, 600));

    expect(onSessionsChange).toHaveBeenCalledTimes(1);
    // Second argument should be absent (undefined) — not force
    expect(onSessionsChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 's1' })]),
    );
    expect(onSessionsChange.mock.calls[0][1]).toBeUndefined();
  });
});
