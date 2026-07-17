import { describe, it, expect, vi } from 'vitest';
import { createSessionManager } from '../../client/sessionManager';
import type { AgentSession } from '../../client/agentSession.types';
import type { SessionEntryData } from '../../client/sessionManager.types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal stub AgentSession. */
function makeSession(id: string): AgentSession {
  const subs = new Set<() => void>();
  let currentTitle = 'Test';
  return {
    id,
    getState: () => ({
      id,
      agentName: 'main',
      conversationId: 'main',
      agentId: undefined,
      title: currentTitle,
      messages: [],
      isLoading: false,
      toolStates: [],
      enableAttachments: true,
    }),
    subscribe: (fn: () => void) => { subs.add(fn); return () => subs.delete(fn); },
    sendMessage: vi.fn(async () => {}),
    cancelMessage: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: () => [],
    setTitle: (title: string) => { currentTitle = title; },
  } as unknown as AgentSession;
}

function makeFactory() {
  const created: string[] = [];
  const factory = vi.fn((data: SessionEntryData) => {
    created.push(data.id);
    return makeSession(data.id);
  });
  return { factory, created };
}

// ── createSessionManager ──────────────────────────────────────────────────────

describe('createSessionManager', () => {
  // ── Initialization ────────────────────────────────────────────────────────

  it('starts with an empty session list when no initialSessions given', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory);
    const state = mgr.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.activeSessionId).toBeUndefined();
  });

  it('uses provided initialSessions and activates the first one', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, {
      initialSessions: [
        { id: 'a', title: 'Alpha' },
        { id: 'b', title: 'Beta' },
      ],
    });
    const state = mgr.getState();
    expect(state.sessions).toHaveLength(2);
    expect(state.activeSessionId).toBe('a');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  // ── createSession ─────────────────────────────────────────────────────────

  it('createSession adds a new session and sets it active', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory);
    const prev = mgr.getState().sessions.length;
    const session = mgr.createSession();
    const state = mgr.getState();
    expect(state.sessions).toHaveLength(prev + 1);
    expect(state.activeSessionId).toBe(session.getState().id);
  });

  it('createSession uses a provided id', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory);
    mgr.createSession({ id: 'custom-id' });
    expect(mgr.getSession('custom-id')).toBeDefined();
  });

  it('createSession uses provided title', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory);
    mgr.createSession({ title: 'My Chat' });
    const state = mgr.getState();
    const lastEntry = state.sessions[state.sessions.length - 1];
    expect(lastEntry.title).toBe('My Chat');
  });

  // ── removeSession ─────────────────────────────────────────────────────────

  it('removeSession removes the entry', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'x', title: 'X' }] });
    mgr.createSession({ id: 'y' });
    mgr.removeSession('x');
    expect(mgr.getState().sessions.map((s) => s.id)).not.toContain('x');
  });

  it('removeSession is a no-op for unknown ids', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory);
    const before = mgr.getState().sessions.length;
    mgr.removeSession('nonexistent');
    expect(mgr.getState().sessions.length).toBe(before);
  });

  it('removeSession calls onRemove callback', () => {
    const { factory } = makeFactory();
    const onRemove = vi.fn();
    const mgr = createSessionManager(factory, {
      initialSessions: [{ id: 'rm', title: 'Remove me' }],
      onRemoveSession: onRemove,
    });
    mgr.removeSession('rm');
    expect(onRemove).toHaveBeenCalledWith('rm');
  });

  it('removeSession shifts active session to a neighbour', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, {
      initialSessions: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    });
    mgr.setActiveSession('a');
    mgr.removeSession('a');
    expect(mgr.getState().activeSessionId).toBe('b');
  });

  // ── setActiveSession ──────────────────────────────────────────────────────

  it('setActiveSession changes the active session', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, {
      initialSessions: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    });
    mgr.setActiveSession('b');
    expect(mgr.getState().activeSessionId).toBe('b');
  });

  it('setActiveSession is a no-op for an unknown id', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'a', title: 'A' }] });
    mgr.setActiveSession('nonexistent');
    expect(mgr.getState().activeSessionId).toBe('a');
  });

  it('setActiveSession is a no-op when it is already active', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'a', title: 'A' }] });
    const listener = vi.fn();
    mgr.subscribe(listener);
    mgr.setActiveSession('a'); // already active
    expect(listener).not.toHaveBeenCalled();
  });

  it('createSession passes all SessionEntryData fields through to the factory', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory);
    const messages = [{ role: 'user' as const, content: 'hello' }];
    const liveHistory = [{ role: 'user' as const, content: 'hello' }];
    mgr.createSession({ id: 'full', title: 'Full', messages, liveHistory } as any);
    const call = factory.mock.calls.find(([d]) => d.id === 'full');
    expect(call).toBeDefined();
    const data = call![0];
    expect(data.messages).toBe(messages);
    expect(data.liveHistory).toBe(liveHistory);
  });

  // ── renameSession ─────────────────────────────────────────────────────────

  it('renameSession updates the session title', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'r', title: 'Old' }] });
    mgr.renameSession('r', 'New');
    const entry = mgr.getState().sessions.find((s) => s.id === 'r');
    expect(entry?.title).toBe('New');
  });

  it('renameSession syncs the new title into session state', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'r', title: 'Old' }] });
    mgr.renameSession('r', 'New');
    const session = mgr.getSession('r')!;
    expect(session.getState().title).toBe('New');
  });

  it('renameSession is a no-op when title is unchanged', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'r', title: 'Same' }] });
    const listener = vi.fn();
    mgr.subscribe(listener);
    mgr.renameSession('r', 'Same');
    expect(listener).not.toHaveBeenCalled();
  });

  // ── getSession / getActiveSession ─────────────────────────────────────────

  it('getSession returns the session by id', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'found', title: 'F' }] });
    expect(mgr.getSession('found')).toBeDefined();
  });

  it('getSession returns undefined for unknown id', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory);
    expect(mgr.getSession('ghost')).toBeUndefined();
  });

  it('getActiveSession returns the session matching activeSessionId', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'active', title: 'A' }] });
    expect(mgr.getActiveSession()).toBeDefined();
    expect(mgr.getActiveSession()!.getState().id).toBe('active');
  });

  // ── subscribe ─────────────────────────────────────────────────────────────

  it('subscribe fires on createSession', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory);
    const listener = vi.fn();
    mgr.subscribe(listener);
    mgr.createSession();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribe fires on removeSession', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'del', title: 'D' }] });
    const listener = vi.fn();
    mgr.subscribe(listener);
    mgr.removeSession('del');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribe unsubscribes correctly', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory);
    const listener = vi.fn();
    const unsub = mgr.subscribe(listener);
    unsub();
    mgr.createSession();
    expect(listener).not.toHaveBeenCalled();
  });

  it('removeSession sets activeSessionId to undefined when the last session is removed', () => {
    // Covers the `order.length === 0` branch in pickFallbackActive (line 142)
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'only', title: 'Only' }] });
    mgr.removeSession('only');
    expect(mgr.getState().activeSessionId).toBeUndefined();
    expect(mgr.getState().sessions).toHaveLength(0);
  });

  it('getActiveSession returns undefined when there is no active session', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'solo', title: 'S' }] });
    mgr.removeSession('solo');
    expect(mgr.getActiveSession()).toBeUndefined();
  });

  it('renameSession is a no-op for an unknown id', () => {
    const { factory } = makeFactory();
    const mgr = createSessionManager(factory, { initialSessions: [{ id: 'r', title: 'Real' }] });
    const listener = vi.fn();
    mgr.subscribe(listener);
    mgr.renameSession('ghost-id', 'Anything');
    expect(listener).not.toHaveBeenCalled();
  });
});
