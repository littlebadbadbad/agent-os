/**
 * Mock BrowserAdapter factory for UI hook tests.
 *
 * Provides a fully typed mock with vi.fn() stubs for every method,
 * plus helpers to simulate backend state changes.
 */

import { vi } from 'vitest';
import type {
  BrowserAdapter,
  BrowserEntry,
  BrowserOutput,
  BrowserNavigateResult,
  BrowserSnapshotResult,
  BrowserWaitResult,
  BrowserLaunchConfig,
  BrowserStreamConnection,
  BrowserStreamCallbacks,
  NetworkQueryOptions,
  NetworkQueryResult,
} from '../../agent/types';
import type { StreamConfig } from '../../agent/streamConfig';

let nextId = 1;

export function resetMockIdCounter(): void {
  nextId = 1;
}

export function makeMockEntry(overrides?: Partial<BrowserEntry>): BrowserEntry {
  const id = `browser_${String(nextId++).padStart(8, '0')}`;
  return {
    id,
    label: overrides?.label ?? `browser-${id.slice(-4)}`,
    alive: true,
    url: null,
    createdAt: new Date().toISOString(),
    outputBytes: 0,
    viewport: { width: 1280, height: 720 },
    useProxy: true,
    tabs: [{ index: 0, url: null, title: null }],
    activeTabIndex: 0,
    launchConfig: {},
    ...overrides,
  };
}

export interface MockAdapter extends BrowserAdapter {
  /** Simulated backend sessions store. */
  _sessions: BrowserEntry[];
  /** Set the sessions list returned by listSessions(). */
  _setSessions(sessions: BrowserEntry[]): void;
  /** Add a session to the simulated store. */
  _addSession(entry: BrowserEntry): void;
  /** Remove a session from the simulated store. */
  _removeSession(id: string): void;
  /** Update a session in the simulated store. */
  _updateSession(id: string, patch: Partial<BrowserEntry>): void;
  /** All vi.fn() calls for assertion. */
  _fns: ReturnType<typeof createMockFns>;
}

function createMockFns() {
  return {
    listSessions: vi.fn<() => Promise<BrowserEntry[]>>(),
    createSession: vi.fn<(opts: {
      label?: string;
      startUrl?: string;
      useProxy?: boolean;
      launchConfig?: BrowserLaunchConfig;
    }) => Promise<BrowserEntry>>(),
    closeSession: vi.fn<(id: string) => Promise<void>>(),
    navigate: vi.fn<(id: string, url: string, opts?: {
      waitUntil?: string;
      timeout?: number;
    }) => Promise<BrowserNavigateResult>>(),
    evaluate: vi.fn<(id: string, script: string) => Promise<unknown>>(),
    readOutput: vi.fn<(id: string, fromOffset: number) => Promise<BrowserOutput>>(),
    snapshot: vi.fn<(id: string) => Promise<BrowserSnapshotResult>>(),
    wait: vi.fn<(id: string, opts?: {
      selector?: string;
      waitUntil?: string;
      timeout?: number;
    }) => Promise<BrowserWaitResult>>(),
    setLaunchConfig: vi.fn<(id: string, config: BrowserLaunchConfig) => Promise<BrowserEntry>>(),
    setProxy: vi.fn<(id: string, useProxy: boolean) => Promise<BrowserEntry>>(),
    switchTab: vi.fn<(id: string, index: number) => Promise<BrowserEntry>>(),
    setViewportSize: vi.fn<(id: string, width: number, height: number) => Promise<BrowserEntry>>(),
    screenshotData: vi.fn<(id: string, selector?: string) => Promise<{
      data: string;
      mimeType: string;
    }>>(),
    connectStream: vi.fn<(id: string, callbacks: BrowserStreamCallbacks, config?: StreamConfig) => BrowserStreamConnection>(),
    getNetworkRequests: vi.fn<(id: string, opts?: NetworkQueryOptions) => Promise<NetworkQueryResult>>(),
    clearNetworkRequests: vi.fn<(id: string, opts?: {
      tabIndex?: number;
    }) => Promise<void>>(),
  };
}

function createMockStreamConnection(): BrowserStreamConnection {
  return {
    close: vi.fn(),
    send: vi.fn(),
    updateConfig: vi.fn(),
  };
}

/**
 * Create a fully typed mock BrowserAdapter.
 * The mock maintains its own internal _sessions store so tests can simulate
 * backend state changes that the polling loop would discover.
 */
export function createMockAdapter(): MockAdapter {
  const fns = createMockFns();
  const sessions: BrowserEntry[] = [];

  // Wire up default implementations.
  fns.listSessions.mockImplementation(async () => [...sessions]);
  fns.createSession.mockImplementation(async (opts) => {
    const label = opts.label ?? 'browser';
    const entry = makeMockEntry({ label, ...(opts.launchConfig ? { launchConfig: opts.launchConfig } : {}) });
    sessions.push(entry);
    return entry;
  });
  fns.closeSession.mockImplementation(async (id: string) => {
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx !== -1) sessions.splice(idx, 1);
  });
  fns.setProxy.mockImplementation(async (id: string, useProxy: boolean) => {
    const entry = sessions.find((s) => s.id === id);
    if (entry) {
      entry.useProxy = useProxy;
      return { ...entry };
    }
    throw new Error(`Session ${id} not found`);
  });
  fns.switchTab.mockImplementation(async (id: string, index: number) => {
    const entry = sessions.find((s) => s.id === id);
    if (entry) {
      if (index < 0 || index >= entry.tabs.length) {
        throw new Error(`Tab index ${index} out of range`);
      }
      entry.activeTabIndex = index;
      return { ...entry };
    }
    throw new Error(`Session ${id} not found`);
  });
  fns.setViewportSize.mockImplementation(async (id: string, width: number, height: number) => {
    const entry = sessions.find((s) => s.id === id);
    if (entry) {
      entry.viewport = { width, height };
      return { ...entry };
    }
    throw new Error(`Session ${id} not found`);
  });
  fns.setLaunchConfig.mockImplementation(async (id: string, config: BrowserLaunchConfig) => {
    const entry = sessions.find((s) => s.id === id);
    if (entry) {
      entry.launchConfig = { ...entry.launchConfig, ...config };
      return { ...entry };
    }
    throw new Error(`Session ${id} not found`);
  });
  fns.connectStream.mockImplementation(() => createMockStreamConnection());

  return {
    ...fns,
    _sessions: sessions,
    _setSessions(s: BrowserEntry[]) {
      sessions.length = 0;
      sessions.push(...s);
    },
    _addSession(entry: BrowserEntry) {
      sessions.push(entry);
    },
    _removeSession(id: string) {
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx !== -1) sessions.splice(idx, 1);
    },
    _updateSession(id: string, patch: Partial<BrowserEntry>) {
      const entry = sessions.find((s) => s.id === id);
      if (entry) Object.assign(entry, patch);
    },
    _fns: fns,
  } as MockAdapter;
}
