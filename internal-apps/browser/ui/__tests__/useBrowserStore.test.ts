/**
 * @vitest-environment happy-dom
 *
 * Comprehensive tests for useBrowserStore hook.
 *
 * Covers:
 *   - Initial state (empty, defaults)
 *   - Session lifecycle (create, close, select)
 *   - Configuration (applyConfig, toggleProxy)
 *   - Tab management (switchTab, updateTabInfo, setActiveTab)
 *   - Console buffers (set, append, getLog, clearSession)
 *   - Stream config (updateStreamConfig, updateViewport, setViewportSize)
 *   - Smart polling (visibility, merge logic)
 *   - Agent-triggered session discovery
 *   - Edge cases (double-create, close nonexistent, out-of-range tabs)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, type RenderHookResult } from '@testing-library/react';
import { useBrowserStore, type BrowserStoreState, type BrowserStoreActions } from '../hooks/useBrowserStore';
import { createMockAdapter, resetMockIdCounter, makeMockEntry, type MockAdapter } from './mockAdapter';

// ── Helpers ───────────────────────────────────────────────────────────────────

type StoreRef = RenderHookResult<BrowserStoreState & BrowserStoreActions, unknown>;

function renderStore(adapter?: MockAdapter) {
  const mock = adapter ?? createMockAdapter();
  const rendered = renderHook(() => useBrowserStore(mock));
  return { rendered, mock };
}

/** Wait for the next React render cycle. */
function tick(): Promise<void> {
  return act(() => Promise.resolve());
}

/** Fast-forward past the initial load effect. */
async function initStore(adapter?: MockAdapter) {
  const { rendered, mock } = renderStore(adapter);
  await tick();
  return { rendered, mock };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetMockIdCounter();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Initial state
// ═════════════════════════════════════════════════════════════════════════════

describe('initial state', () => {
  it('starts with empty sessions when adapter has none', async () => {
    const mock = createMockAdapter();
    mock._fns.listSessions.mockResolvedValue([]);
    const { rendered } = await initStore(mock);

    expect(rendered.result.current.sessions).toEqual([]);
    expect(rendered.result.current.selectedId).toBeNull();
    expect(rendered.result.current.selectedEntry).toBeNull();
    expect(rendered.result.current.creating).toBe(false);
    expect(rendered.result.current.configApplying).toBe(false);
    expect(rendered.result.current.tabLogs).toEqual({});
    expect(rendered.result.current.activeTabBySession).toEqual({});
  });

  it('loads sessions from adapter on mount', async () => {
    const mock = createMockAdapter();
    const entries = [makeMockEntry({ label: 'Session 1' }), makeMockEntry({ label: 'Session 2' })];
    mock._fns.listSessions.mockResolvedValue(entries);
    const { rendered } = await initStore(mock);

    expect(rendered.result.current.sessions).toHaveLength(2);
    expect(rendered.result.current.sessions[0].label).toBe('Session 1');
    expect(rendered.result.current.selectedId).toBe(entries[0].id);
    expect(rendered.result.current.selectedEntry?.id).toBe(entries[0].id);
  });

  it('has default stream config and viewport', async () => {
    const { rendered } = await initStore();

    expect(rendered.result.current.streamConfig).toEqual({ fps: 15, quality: 60 });
    expect(rendered.result.current.viewport).toEqual({ width: 1280, height: 720 });
  });

  it('auto-selects first session when multiple exist', async () => {
    const mock = createMockAdapter();
    const entries = [makeMockEntry(), makeMockEntry(), makeMockEntry()];
    mock._fns.listSessions.mockResolvedValue(entries);
    const { rendered } = await initStore(mock);

    expect(rendered.result.current.selectedId).toBe(entries[0].id);
  });

  it('handles listSessions rejection gracefully', async () => {
    const mock = createMockAdapter();
    mock._fns.listSessions.mockRejectedValue(new Error('Backend offline'));
    const { rendered } = await initStore(mock);

    expect(rendered.result.current.sessions).toEqual([]);
    expect(rendered.result.current.selectedId).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Session lifecycle
// ═════════════════════════════════════════════════════════════════════════════

describe('session lifecycle', () => {
  it('creates a new session and selects it', async () => {
    const { rendered, mock } = await initStore();

    let entryId: string;
    await act(async () => {
      await rendered.result.current.create('https://example.com');
    });

    expect(rendered.result.current.sessions).toHaveLength(1);
    expect(rendered.result.current.selectedId).toBeTruthy();
    expect(rendered.result.current.selectedEntry).not.toBeNull();
    entryId = rendered.result.current.selectedId!;

    // Verify adapter was called.
    expect(mock._fns.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ startUrl: 'https://example.com', useProxy: true }),
    );
    // Verify the session label is derived from the URL.
    expect(rendered.result.current.sessions[0].label).toBe('example.com');
  });

  it('creates a session without URL uses "browser" label', async () => {
    const { rendered } = await initStore();

    await act(async () => {
      await rendered.result.current.create();
    });

    expect(rendered.result.current.sessions).toHaveLength(1);
    expect(rendered.result.current.sessions[0].label).toBe('browser');
  });

  it('closes a session and removes it from the list', async () => {
    const { rendered, mock } = await initStore();
    mock._fns.listSessions.mockResolvedValue([]);

    await act(async () => {
      await rendered.result.current.create();
    });
    const id = rendered.result.current.selectedId!;

    await act(async () => {
      await rendered.result.current.close(id);
    });

    expect(rendered.result.current.sessions).toHaveLength(0);
    expect(rendered.result.current.selectedId).toBeNull();
    expect(rendered.result.current.selectedEntry).toBeNull();
    expect(mock._fns.closeSession).toHaveBeenCalledWith(id);
  });

  it('closing a session also clears its console buffers', async () => {
    const { rendered } = await initStore();

    await act(async () => {
      await rendered.result.current.create();
    });
    const id = rendered.result.current.selectedId!;

    act(() => {
      rendered.result.current.setConsoleOutput(id, 0, 'test output');
    });
    expect(rendered.result.current.getLog(id, 0)).toBe('test output');

    await act(async () => {
      await rendered.result.current.close(id);
    });

    expect(rendered.result.current.getLog(id, 0)).toBe('');
  });

  it('prevents double creation (creating guard)', async () => {
    const { rendered } = await initStore();

    // Call create twice in quick succession.
    let promise1: Promise<void>;
    let promise2: Promise<void>;
    act(() => {
      promise1 = rendered.result.current.create();
      promise2 = rendered.result.current.create();
    });
    await act(async () => {
      await promise1;
      await promise2;
    });

    // Only one session should have been created.
    expect(rendered.result.current.sessions).toHaveLength(1);
  });

  it('selects a specific session', async () => {
    const { rendered } = await initStore();

    await act(async () => {
      await rendered.result.current.create('http://a.com');
    });
    await act(async () => {
      await rendered.result.current.create('http://b.com');
    });

    const firstId = rendered.result.current.sessions[0].id;
    act(() => {
      rendered.result.current.select(firstId);
    });

    expect(rendered.result.current.selectedId).toBe(firstId);
  });

  it('auto-falls back to last session when selected is removed', async () => {
    const { rendered } = await initStore();

    await act(async () => {
      await rendered.result.current.create('http://a.com');
    });
    await act(async () => {
      await rendered.result.current.create('http://b.com');
    });

    const firstId = rendered.result.current.sessions[0].id;
    const lastId = rendered.result.current.sessions[1].id;

    act(() => {
      rendered.result.current.select(firstId);
    });

    await act(async () => {
      await rendered.result.current.close(firstId);
    });

    // Should fall back to the remaining session.
    expect(rendered.result.current.selectedId).toBe(lastId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Configuration
// ═════════════════════════════════════════════════════════════════════════════

describe('configuration', () => {
  it('applies new config and updates session entry', async () => {
    const { rendered, mock } = await initStore();

    await act(async () => {
      await rendered.result.current.create();
    });
    const id = rendered.result.current.selectedId!;

    // Make setLaunchConfig return updated entry.
    mock._fns.setLaunchConfig.mockResolvedValue({
      ...rendered.result.current.selectedEntry!,
      launchConfig: { headless: false },
    });

    await act(async () => {
      await rendered.result.current.applyConfig(id, { headless: false });
    });

    expect(mock._fns.setLaunchConfig).toHaveBeenCalledWith(id, { headless: false });
  });

  it('toggles proxy on and off', async () => {
    const { rendered, mock } = await initStore();

    await act(async () => {
      await rendered.result.current.create();
    });
    const id = rendered.result.current.selectedId!;

    // Initially proxy is on.
    expect(rendered.result.current.sessions.find((s) => s.id === id)?.useProxy).toBe(true);

    // Toggle off.
    mock._fns.setProxy.mockResolvedValue({
      ...rendered.result.current.selectedEntry!,
      useProxy: false,
    });
    await act(async () => {
      await rendered.result.current.toggleProxy(id);
    });

    expect(mock._fns.setProxy).toHaveBeenCalledWith(id, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Tab management
// ═════════════════════════════════════════════════════════════════════════════

describe('tab management', () => {
  it('switches tab within a session', async () => {
    const { rendered, mock } = await initStore();

    await act(async () => {
      await rendered.result.current.create();
    });
    const id = rendered.result.current.selectedId!;

    // Simulate that the backend has multiple tabs.
    const updatedEntry = {
      ...rendered.result.current.selectedEntry!,
      tabs: [
        { index: 0, url: 'http://a.com', title: 'Page A' },
        { index: 1, url: 'http://b.com', title: 'Page B' },
      ],
      activeTabIndex: 1,
    };
    mock._fns.switchTab.mockResolvedValue(updatedEntry);

    await act(async () => {
      await rendered.result.current.switchTab(id, 1);
    });

    expect(mock._fns.switchTab).toHaveBeenCalledWith(id, 1);
    expect(rendered.result.current.sessions.find((s) => s.id === id)?.activeTabIndex).toBe(1);
  });

  it('updates tab info from stream message', async () => {
    const { rendered } = await initStore();

    await act(async () => {
      await rendered.result.current.create();
    });
    const id = rendered.result.current.selectedId!;

    const newTabs = [
      { index: 0, url: 'http://a.com', title: 'A' },
      { index: 1, url: 'http://b.com', title: 'B' },
    ];

    act(() => {
      rendered.result.current.updateTabInfo(id, newTabs, 1);
    });

    const session = rendered.result.current.sessions.find((s) => s.id === id);
    expect(session?.tabs).toEqual(newTabs);
    expect(session?.activeTabIndex).toBe(1);
  });

  it('sets active tab for a session (console routing)', async () => {
    const { rendered } = await initStore();

    act(() => {
      rendered.result.current.setActiveTab('session-1', 2);
    });

    expect(rendered.result.current.activeTabBySession['session-1']).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Console buffers
// ═════════════════════════════════════════════════════════════════════════════

describe('console buffers', () => {
  it('sets and gets console output per session+tab', async () => {
    const { rendered } = await initStore();

    act(() => {
      rendered.result.current.setConsoleOutput('s1', 0, 'line1\nline2');
    });

    expect(rendered.result.current.getLog('s1', 0)).toBe('line1\nline2');
  });

  it('appends to existing console output', async () => {
    const { rendered } = await initStore();

    act(() => {
      rendered.result.current.setConsoleOutput('s1', 0, 'line1\n');
    });
    act(() => {
      rendered.result.current.appendConsoleOutput('s1', 0, 'line2\n');
    });

    expect(rendered.result.current.getLog('s1', 0)).toBe('line1\nline2\n');
  });

  it('isolates console per tab within the same session', async () => {
    const { rendered } = await initStore();

    act(() => {
      rendered.result.current.setConsoleOutput('s1', 0, 'tab0 output');
      rendered.result.current.setConsoleOutput('s1', 1, 'tab1 output');
    });

    expect(rendered.result.current.getLog('s1', 0)).toBe('tab0 output');
    expect(rendered.result.current.getLog('s1', 1)).toBe('tab1 output');
  });

  it('isolates console per session', async () => {
    const { rendered } = await initStore();

    act(() => {
      rendered.result.current.setConsoleOutput('s1', 0, 'session1');
      rendered.result.current.setConsoleOutput('s2', 0, 'session2');
    });

    expect(rendered.result.current.getLog('s1', 0)).toBe('session1');
    expect(rendered.result.current.getLog('s2', 0)).toBe('session2');
  });

  it('returns empty string for unknown session+tab', async () => {
    const { rendered } = await initStore();

    expect(rendered.result.current.getLog('nonexistent', 99)).toBe('');
  });

  it('clears all console data for a session', async () => {
    const { rendered } = await initStore();

    act(() => {
      rendered.result.current.setConsoleOutput('s1', 0, 'data');
      rendered.result.current.setConsoleOutput('s1', 1, 'more data');
      rendered.result.current.setActiveTab('s1', 1);
    });

    act(() => {
      rendered.result.current.clearSession('s1');
    });

    expect(rendered.result.current.getLog('s1', 0)).toBe('');
    expect(rendered.result.current.getLog('s1', 1)).toBe('');
    expect(rendered.result.current.activeTabBySession['s1']).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Stream config
// ═════════════════════════════════════════════════════════════════════════════

describe('stream config', () => {
  it('updates stream config partially', async () => {
    const { rendered } = await initStore();

    act(() => {
      rendered.result.current.updateStreamConfig({ fps: 30 });
    });

    expect(rendered.result.current.streamConfig.fps).toBe(30);
    expect(rendered.result.current.streamConfig.quality).toBe(60); // unchanged
  });

  it('updates viewport dimensions', async () => {
    const { rendered } = await initStore();

    act(() => {
      rendered.result.current.updateViewport(1920, 1080);
    });

    expect(rendered.result.current.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it('updates viewport on backend via setViewportSize', async () => {
    const { rendered, mock } = await initStore();

    await act(async () => {
      await rendered.result.current.create();
    });
    const id = rendered.result.current.selectedId!;

    mock._fns.setViewportSize.mockResolvedValue({
      ...rendered.result.current.selectedEntry!,
      viewport: { width: 800, height: 600 },
    });

    await act(async () => {
      await rendered.result.current.setViewportSize(id, 800, 600);
    });

    expect(mock._fns.setViewportSize).toHaveBeenCalledWith(id, 800, 600);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Smart polling
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Helper: advance fake timers past the POLL_INTERVAL_MS and flush all
 * pending microtasks so async `setInterval` callbacks complete.
 */
async function tickPoll() {
  vi.advanceTimersByTime(3000);
  // Flush pending microtasks from the async poll callback.
  await act(() => Promise.resolve());
  await act(() => Promise.resolve());
}

describe('smart polling', () => {
  it('polls and merges session state', async () => {
    const mock = createMockAdapter();
    const entries = [makeMockEntry()];
    mock._fns.listSessions.mockResolvedValue(entries);
    const { rendered } = await initStore(mock);

    const callsBefore = mock._fns.listSessions.mock.calls.length;

    await tickPoll();

    expect(mock._fns.listSessions.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('adds newly discovered sessions from backend', async () => {
    const mock = createMockAdapter();
    const entries = [makeMockEntry()];
    mock._fns.listSessions.mockResolvedValue(entries);
    const { rendered } = await initStore(mock);

    // Initially 1 session from initial load.
    expect(rendered.result.current.sessions).toHaveLength(1);

    // A second session appears (agent launched it).
    const newEntry = makeMockEntry({ label: 'Agent Launched' });
    mock._fns.listSessions.mockResolvedValue([...entries, newEntry]);

    await tickPoll();

    expect(rendered.result.current.sessions).toHaveLength(2);
    expect(rendered.result.current.sessions[1].label).toBe('Agent Launched');
  });

  it('removes stale sessions that disappeared from backend', async () => {
    const mock = createMockAdapter();
    const entries = [makeMockEntry({ label: 'S1' }), makeMockEntry({ label: 'S2' })];
    mock._fns.listSessions.mockResolvedValue(entries);
    const { rendered } = await initStore(mock);

    // Initially 2 sessions.
    expect(rendered.result.current.sessions).toHaveLength(2);

    // S2 was closed by the agent.
    mock._fns.listSessions.mockResolvedValue([entries[0]]);

    await tickPoll();

    expect(rendered.result.current.sessions).toHaveLength(1);
    expect(rendered.result.current.sessions[0].label).toBe('S1');
  });

  it('updates alive/url from backend poll', async () => {
    const mock = createMockAdapter();
    const entry = makeMockEntry({ label: 'Test' });
    mock._fns.listSessions.mockResolvedValue([entry]);
    const { rendered } = await initStore(mock);

    // Simulate backend update: navigated to a URL.
    const updatedEntry = { ...entry, url: 'http://example.com/page' };
    mock._fns.listSessions.mockResolvedValue([updatedEntry]);

    await tickPoll();

    expect(rendered.result.current.sessions[0].url).toBe('http://example.com/page');
  });

  it('does NOT poll when document is hidden', async () => {
    const mock = createMockAdapter();
    mock._fns.listSessions.mockResolvedValue([makeMockEntry()]);
    const { rendered } = await initStore(mock);

    // Ensure the initial load happened.
    expect(rendered.result.current.sessions).toHaveLength(1);
    const callsBefore = mock._fns.listSessions.mock.calls.length;

    // Set hidden and advance past multiple poll intervals.
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });

    vi.advanceTimersByTime(6000);
    await act(() => Promise.resolve());

    // Should NOT have polled while hidden.
    expect(mock._fns.listSessions.mock.calls.length).toBe(callsBefore);
  });

  it('polls when visibility changes to visible', async () => {
    const mock = createMockAdapter();
    mock._fns.listSessions.mockResolvedValue([makeMockEntry()]);
    const { rendered } = await initStore(mock);

    // Start hidden.
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });

    const callsBefore = mock._fns.listSessions.mock.calls.length;

    // Switch to visible — should trigger immediate poll via visibilitychange.
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // Flush the async poll callback.
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());

    expect(mock._fns.listSessions.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Agent-triggered sync (simulated backend changes)
// ═════════════════════════════════════════════════════════════════════════════

describe('agent-triggered sync', () => {
  it('discovers sessions created by the agent', async () => {
    const mock = createMockAdapter();
    // Initially empty.
    mock._fns.listSessions.mockResolvedValue([]);
    const { rendered } = await initStore(mock);

    expect(rendered.result.current.sessions).toHaveLength(0);

    // Agent launches a browser.
    const agentEntry = makeMockEntry({ label: 'Agent Session' });
    mock._fns.listSessions.mockResolvedValue([agentEntry]);

    await tickPoll();

    expect(rendered.result.current.sessions).toHaveLength(1);
    expect(rendered.result.current.sessions[0].label).toBe('Agent Session');
  });

  it('reflects agent-triggered tab switch', async () => {
    const mock = createMockAdapter();
    const entry = makeMockEntry({
      label: 'Test',
      tabs: [
        { index: 0, url: 'http://a.com', title: 'A' },
        { index: 1, url: 'http://b.com', title: 'B' },
      ],
      activeTabIndex: 0,
    });
    mock._fns.listSessions.mockResolvedValue([entry]);
    const { rendered } = await initStore(mock);

    // Agent switches to tab 1 via backend.
    const updatedEntry = { ...entry, activeTabIndex: 1 };
    mock._fns.listSessions.mockResolvedValue([updatedEntry]);

    await tickPoll();

    expect(rendered.result.current.sessions[0].activeTabIndex).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Edge cases
// ═════════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('handles create rejection gracefully', async () => {
    const mock = createMockAdapter();
    mock._fns.createSession.mockRejectedValue(new Error('Launch failed'));
    const { rendered } = await initStore(mock);

    await act(async () => {
      await rendered.result.current.create('http://fail.com');
    });

    // Should not have added any session.
    expect(rendered.result.current.sessions).toHaveLength(0);
    expect(rendered.result.current.creating).toBe(false);
  });

  it('handles close of nonexistent session', async () => {
    const { rendered } = await initStore();

    // Should not throw.
    await act(async () => {
      await rendered.result.current.close('nonexistent');
    });
  });

  it('handles toggleProxy on nonexistent session', async () => {
    const { rendered } = await initStore();

    await act(async () => {
      await rendered.result.current.toggleProxy('nonexistent');
    });
    // Should not throw.
  });

  it('handles setViewportSize rejection', async () => {
    const mock = createMockAdapter();
    const entry = makeMockEntry();
    mock._fns.listSessions.mockResolvedValue([entry]);
    mock._fns.setViewportSize.mockRejectedValue(new Error('Resize failed'));
    const { rendered } = await initStore(mock);

    await act(async () => {
      await rendered.result.current.setViewportSize(entry.id, 9999, 9999);
    });
    // Should not throw — error is swallowed.
  });

  it('handles switchTab rejection', async () => {
    const mock = createMockAdapter();
    const entry = makeMockEntry();
    mock._fns.listSessions.mockResolvedValue([entry]);
    mock._fns.switchTab.mockRejectedValue(new Error('Tab switch failed'));
    const { rendered } = await initStore(mock);

    await act(async () => {
      await rendered.result.current.switchTab(entry.id, 999);
    });
    // Should not throw — error is swallowed.
  });

  it('handles applyConfig rejection', async () => {
    const mock = createMockAdapter();
    const entry = makeMockEntry();
    mock._fns.listSessions.mockResolvedValue([entry]);
    mock._fns.setLaunchConfig.mockRejectedValue(new Error('Config failed'));
    const { rendered } = await initStore(mock);

    await act(async () => {
      await rendered.result.current.applyConfig(entry.id, { headless: false });
    });

    expect(rendered.result.current.configApplying).toBe(false);
  });

  it('handles setViewportSize on nonexistent session', async () => {
    const { rendered } = await initStore();

    await act(async () => {
      await rendered.result.current.setViewportSize('nonexistent', 100, 100);
    });
    // Should not throw.
  });

  it('derives selectedEntry correctly when selectedId is valid', async () => {
    const mock = createMockAdapter();
    const entries = [makeMockEntry({ label: 'Alpha' }), makeMockEntry({ label: 'Beta' })];
    mock._fns.listSessions.mockResolvedValue(entries);
    const { rendered } = await initStore(mock);

    act(() => {
      rendered.result.current.select(entries[1].id);
    });

    expect(rendered.result.current.selectedEntry?.label).toBe('Beta');
  });

  it('returns null selectedEntry when no sessions exist', async () => {
    const mock = createMockAdapter();
    mock._fns.listSessions.mockResolvedValue([]);
    const { rendered } = await initStore(mock);

    expect(rendered.result.current.selectedEntry).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Lifecycle clean-up
// ═════════════════════════════════════════════════════════════════════════════

describe('lifecycle cleanup', () => {
  it('clears interval on unmount', async () => {
    const mock = createMockAdapter();
    mock._fns.listSessions.mockResolvedValue([makeMockEntry()]);
    const { rendered, unmount } = renderHook(() => useBrowserStore(mock));
    await tick();

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
