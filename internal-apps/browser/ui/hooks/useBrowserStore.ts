/**
 * internal-apps/browser/ui/hooks/useBrowserStore.ts
 *
 * Unified state store for the Browser panel.
 * Merges the responsibilities of three old hooks:
 *   - useBrowserSessions  (session lifecycle)
 *   - useBrowserConsole   (per-tab console buffers)
 *   - useStreamConfig     (stream FPS/quality + viewport)
 *
 * Smart polling: only ticks when the document is visible, and only
 * refreshes fields that have actually changed (via adapter.listSessions).
 *
 * No classes — single hook, pure functional state reducer pattern.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  BrowserAdapter,
  BrowserEntry,
  BrowserLaunchConfig,
  BrowserTabInfo,
} from '../../agent/types';
import type { StreamConfig } from '../../agent/streamConfig';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_STREAM_CONFIG: StreamConfig = { fps: 15, quality: 60 };
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const POLL_INTERVAL_MS = 3000;

// ── State shape ────────────────────────────────────────────────────────────────

export interface BrowserStoreState {
  /** All browser sessions currently open. */
  sessions: BrowserEntry[];
  /** Currently selected session id, or null. */
  selectedId: string | null;
  /** True while a session creation is in-flight. */
  creating: boolean;
  /** True while a config-triggered restart is in progress. */
  configApplying: boolean;
  /** Per-session × per-tab console text buffers. */
  tabLogs: Record<string, Record<number, string>>;
  /** Active tab index per session (for routing stream console messages). */
  activeTabBySession: Record<string, number>;
  /** Live stream configuration (global, shared across sessions). */
  streamConfig: StreamConfig;
  /** Current viewport dimensions. */
  viewport: { width: number; height: number };
}

// ── Actions ────────────────────────────────────────────────────────────────────

export interface BrowserStoreActions {
  /** The derived currently-selected BrowserEntry, or null. */
  selectedEntry: BrowserEntry | null;

  /** Select a session by id. */
  select(id: string): void;
  /** Create a new browser session. */
  create(startUrl?: string, useProxy?: boolean, launchConfig?: BrowserLaunchConfig): Promise<void>;
  /** Close and remove a session. */
  close(id: string): Promise<void>;
  /** Update launch config on a live session (restarts the browser). */
  applyConfig(id: string, config: BrowserLaunchConfig): Promise<void>;
  /** Toggle proxy on/off for a session. */
  toggleProxy(id: string): Promise<void>;
  /** Switch active tab within a session. */
  switchTab(id: string, index: number): Promise<void>;
  /** Resize the active page viewport. */
  setViewportSize(id: string, width: number, height: number): Promise<void>;

  /** Patch tab list + active tab index from a stream info message. */
  updateTabInfo(id: string, tabs: BrowserTabInfo[], activeTabIndex: number): void;
  /** Set the active tab for a session (console routing). */
  setActiveTab(sessionId: string, tabIndex: number): void;
  /** Replace the entire console buffer for a session+tab. */
  setConsoleOutput(sessionId: string, tabIndex: number, text: string): void;
  /** Append to the console buffer for a session+tab. */
  appendConsoleOutput(sessionId: string, tabIndex: number, text: string): void;
  /** Get the console text for a specific session+tab. */
  getLog(sessionId: string, tabIndex: number): string;
  /** Clear all console data for a session (all tabs). */
  clearSession(sessionId: string): void;

  /** Update stream FPS / quality. */
  updateStreamConfig(partial: Partial<StreamConfig>): void;
  /** Update viewport dimensions. */
  updateViewport(width: number, height: number): void;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useBrowserStore(adapter: BrowserAdapter): BrowserStoreState & BrowserStoreActions {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<BrowserEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [configApplying, setConfigApplying] = useState(false);

  // ── Console state ───────────────────────────────────────────────────────────
  const [tabLogs, setTabLogs] = useState<Record<string, Record<number, string>>>({});
  const [activeTabBySession, setActiveTabBySession] = useState<Record<string, number>>({});

  // ── Stream config state ─────────────────────────────────────────────────────
  const [streamConfig, setStreamConfig] = useState<StreamConfig>({ ...DEFAULT_STREAM_CONFIG });
  const [viewport, setViewport] = useState<{ width: number; height: number }>({ ...DEFAULT_VIEWPORT });

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const creatingRef = useRef(false);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // ── Derived ─────────────────────────────────────────────────────────────────
  const validSelectedId: string | null =
    sessions.some((s) => s.id === selectedId)
      ? selectedId
      : sessions.length > 0
        ? sessions[sessions.length - 1].id
        : null;

  const selectedEntry = sessions.find((s) => s.id === validSelectedId) ?? null;

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    adapter.listSessions().then((list) => {
      setSessions(list);
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
      }
    }).catch(() => {});
    // Only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  // ── Smart polling: only when document is visible ────────────────────────────
  useEffect(() => {
    const poll = async () => {
      const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
      if (!isVisible) return;
      try {
        const list = await adapterRef.current.listSessions();
        setSessions((prev) => {
          // Merge: keep prev entries that still exist, update alive/url from fresh.
          const merged = prev
            .filter((s) => list.some((l) => l.id === s.id))
            .map((s) => {
              const fresh = list.find((l) => l.id === s.id);
              return fresh
                ? { ...s, alive: fresh.alive, url: fresh.url, tabs: fresh.tabs, activeTabIndex: fresh.activeTabIndex }
                : s;
            });
          // Add any new sessions that appeared (e.g. launched by agent).
          for (const fresh of list) {
            if (!merged.some((m) => m.id === fresh.id)) {
              merged.push(fresh);
            }
          }
          return merged;
        });
      } catch {
        // Backend may be restarting — ignore.
      }
    };

    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);

    // Also poll immediately when visibility changes to visible.
    const onVisible = () => { poll(); };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, []);

  // ── Session actions ─────────────────────────────────────────────────────────

  const create = useCallback(
    async (startUrl?: string, useProxy?: boolean, launchConfig?: BrowserLaunchConfig) => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      setCreating(true);
      try {
        const label = startUrl
          ? new URL(startUrl.startsWith('http') ? startUrl : `https://${startUrl}`).hostname
          : 'browser';
        const entry = await adapterRef.current.createSession({
          label,
          startUrl,
          useProxy: useProxy ?? true,
          launchConfig,
        });
        setSessions((prev) => [...prev, entry]);
        setSelectedId(entry.id);
      } catch {
        // noop
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [],
  );

  const close = useCallback(async (id: string) => {
    try {
      await adapterRef.current.closeSession(id);
    } catch {
      // ignore
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
    clearSession(id);
  }, []);

  const applyConfig = useCallback(async (id: string, config: BrowserLaunchConfig) => {
    setConfigApplying(true);
    try {
      const updated = await adapterRef.current.setLaunchConfig(id, config);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    } catch {
      // ignore
    } finally {
      setConfigApplying(false);
    }
  }, []);

  const toggleProxy = useCallback(
    async (id: string) => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session) return;
      try {
        const updated = await adapterRef.current.setProxy(id, !session.useProxy);
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
      } catch {
        // ignore
      }
    },
    [],
  );

  const switchTab = useCallback(async (id: string, index: number) => {
    try {
      const updated = await adapterRef.current.switchTab(id, index);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    } catch {
      // ignore
    }
  }, []);

  const setViewportSizeCb = useCallback(
    async (id: string, width: number, height: number) => {
      try {
        const updated = await adapterRef.current.setViewportSize(id, width, height);
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)));
      } catch {
        // Viewport resize failed — UI retains the value.
      }
    },
    [],
  );

  const updateTabInfo = useCallback(
    (id: string, tabs: BrowserTabInfo[], activeTabIndex: number) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, tabs, activeTabIndex } : s)),
      );
    },
    [],
  );

  // ── Console actions ─────────────────────────────────────────────────────────

  const setActiveTab = useCallback((sessionId: string, tabIndex: number) => {
    setActiveTabBySession((prev) => ({ ...prev, [sessionId]: tabIndex }));
  }, []);

  const setConsoleOutput = useCallback((sessionId: string, tabIndex: number, text: string) => {
    setTabLogs((prev) => ({
      ...prev,
      [sessionId]: { ...prev[sessionId], [tabIndex]: text },
    }));
  }, []);

  const appendConsoleOutput = useCallback((sessionId: string, tabIndex: number, text: string) => {
    setTabLogs((prev) => ({
      ...prev,
      [sessionId]: {
        ...(prev[sessionId] ?? {}),
        [tabIndex]: (prev[sessionId]?.[tabIndex] ?? '') + text,
      },
    }));
  }, []);

  const getLog = useCallback(
    (sessionId: string, tabIndex: number): string => tabLogs[sessionId]?.[tabIndex] ?? '',
    [tabLogs],
  );

  const clearSession = useCallback((sessionId: string) => {
    setTabLogs((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    setActiveTabBySession((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  // ── Stream config actions ───────────────────────────────────────────────────

  const updateStreamConfig = useCallback((partial: Partial<StreamConfig>) => {
    setStreamConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const updateViewport = useCallback((width: number, height: number) => {
    setViewport({ width, height });
  }, []);

  // ── Return ──────────────────────────────────────────────────────────────────

  return {
    // State
    sessions,
    selectedId: validSelectedId,
    creating,
    configApplying,
    tabLogs,
    activeTabBySession,
    streamConfig,
    viewport,
    // Derived
    selectedEntry,
    // Session actions
    select: setSelectedId,
    create,
    close,
    applyConfig,
    toggleProxy,
    switchTab,
    setViewportSize: setViewportSizeCb,
    updateTabInfo,
    // Console actions
    setActiveTab,
    setConsoleOutput,
    appendConsoleOutput,
    getLog,
    clearSession,
    // Stream actions
    updateStreamConfig,
    updateViewport,
  };
}
