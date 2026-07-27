import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactElement,
} from 'react';
import type {
  BrowserAdapter,
  BrowserEntry,
  BrowserLaunchConfig,
  StreamConfig,
} from '../agent/index';
import { DEFAULT_STREAM_CONFIG } from '../agent/index';
import type { BrowserPageInfo } from './BrowserSessionView';
import { BrowserTabBar } from './BrowserTabBar';
import { BrowserSessionView } from './BrowserSessionView';
import styles from './BrowserPanel.module.scss';

// ── BrowserPanel ──────────────────────────────────────────────────────────────

export interface BrowserPanelProps {
  adapter: BrowserAdapter;
  sessionId: string;
}

export function BrowserPanel({ adapter, sessionId }: BrowserPanelProps): ReactElement {
  const [sessions, setSessions]     = useState<BrowserEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating]     = useState(false);
  const [showNewBar, setShowNewBar] = useState(false);
  const [urlInput, setUrlInput]     = useState('');
  const [useProxy, setUseProxy]     = useState(true);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const [consoleLogs, setConsoleLogs] = useState<Record<string, string>>({});

  // ── Stream config & viewport state (lifted) ─────────────────────────────
  const [streamConfig, setStreamConfig] = useState<StreamConfig>({ ...DEFAULT_STREAM_CONFIG });
  const [viewport, setViewport] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });
  const [pageInfo, setPageInfo]       = useState<Record<string, BrowserPageInfo>>({});

  const [addrInput, setAddrInput]   = useState('');
  const [navigating, setNavigating] = useState(false);

  const [jsInput, setJsInput]     = useState('');
  const [jsRunning, setJsRunning] = useState(false);
  const [jsResult, setJsResult]   = useState<string | null>(null);
  const jsInputRef      = useRef<HTMLInputElement>(null);
  const consoleEndRef   = useRef<HTMLDivElement>(null);
  const addrFocusedRef  = useRef(false);

  // Pending launch config for the NEXT new session (controlled via BrowserTabBar ⚙)
  const [newSessionConfig, setNewSessionConfig] = useState<BrowserLaunchConfig>({});
  // Whether a config-triggered restart is in progress for the selected session
  const [configApplying, setConfigApplying] = useState(false);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    adapter.listSessions({ sessionId }).then(list => {
      setSessions(list);
      if (list.length > 0) setSelectedId(list[0].id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Periodic session-list sync (3 s) ──────────────────────────────────────
  useEffect(() => {
    const timerId = setInterval(async () => {
      try {
        const list = await adapter.listSessions({ sessionId });
        setSessions(prev =>
          prev
            .filter(s => list.some(l => l.id === s.id))
            .map(s => {
              const fresh = list.find(l => l.id === s.id);
              return fresh ? { ...s, alive: fresh.alive, url: fresh.url } : s;
            }),
        );
      } catch { /* backend restarting */ }
    }, 3000);
    return () => clearInterval(timerId);
  }, [adapter, sessionId]);

  // ── Derive selected id ────────────────────────────────────────────────────
  const validSelectedId: string | null =
    sessions.some(s => s.id === selectedId)
      ? selectedId
      : sessions.length > 0 ? sessions[sessions.length - 1].id : null;

  // ── Create session ────────────────────────────────────────────────────────
  const handleCreate = useCallback(async (startUrl?: string) => {
    if (creating) return;
    setCreating(true);
    setShowNewBar(false);
    setUrlInput('');
    try {
      const entry = await adapter.createSession({
        label: startUrl ? new URL(startUrl).hostname : 'browser',
        startUrl,
        useProxy,
        launchConfig: newSessionConfig,
        sessionId,
      });
      setSessions(prev => [...prev, entry]);
      setSelectedId(entry.id);
    } catch {
      // noop
    } finally {
      setCreating(false);
    }
  }, [adapter, creating, useProxy, sessionId]);

  // ── Close session ─────────────────────────────────────────────────────────────
  const handleClose = useCallback(async (id: string) => {
    try { await adapter.closeSession(id, sessionId); } catch {}
    setSessions(prev => prev.filter(s => s.id !== id));
    setSelectedId(prev => prev === id ? null : prev);
    setConsoleLogs(prev => { const n = { ...prev }; delete n[id]; return n; });
    setPageInfo(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, [adapter, sessionId]);

  // ── Apply launch config change to a live session ───────────────────────────────
  const handleApplyConfig = useCallback(async (
    id: string,
    config: BrowserLaunchConfig,
  ) => {
    setConfigApplying(true);
    try {
      const updated = await adapter.setLaunchConfig(id, config, sessionId);
      setSessions(prev => prev.map(s => s.id === id ? { ...s, ...updated } : s));
    } catch { /* ignore */ } finally {
      setConfigApplying(false);
    }
  }, [adapter, sessionId]);

  // ── Toggle proxy on a live session ────────────────────────────────────────────
  const handleToggleProxy = useCallback(async (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    try {
      const updated = await adapter.setProxy(id, !session.useProxy, sessionId);
      setSessions(prev => prev.map(s => s.id === id ? { ...s, ...updated } : s));
    } catch { /* ignore — UI will reflect existing state */ }
  }, [adapter, sessions, sessionId]);

  // ── Switch active tab within a session ─────────────────────────────────
  const handleSwitchTab = useCallback(async (id: string, index: number) => {
    try {
      const updated = await adapter.switchTab(id, index, sessionId);
      setSessions(prev => prev.map(s => s.id === id ? { ...s, ...updated } : s));
    } catch { /* ignore */ }
  }, [adapter, sessionId]);

  // ── Stream config change (FPS / quality) ────────────────────────────────
  const handleStreamConfigChange = useCallback((partial: Partial<StreamConfig>) => {
    setStreamConfig(prev => ({ ...prev, ...partial }));
  }, []);

  // ── Viewport resize ──────────────────────────────────────────────────────
  const handleViewportResize = useCallback(async (width: number, height: number) => {
    setViewport({ width, height });
    if (!validSelectedId) return;
    try {
      const updated = await adapter.setViewportSize(validSelectedId, width, height, sessionId);
      setSessions(prev => prev.map(s => s.id === validSelectedId ? { ...s, ...updated } : s));
    } catch { /* viewport resize failed — UI retains the value */ }
  }, [adapter, sessionId, validSelectedId]);

  // ── Page info from live stream ────────────────────────────────────────────
  const handlePageInfo = useCallback((
    browserId: string,
    info: BrowserPageInfo & { consoleOutput?: string; consoleAppend?: string },
  ) => {
    setPageInfo(prev => ({
      ...prev,
      [browserId]: { url: info.url, title: info.title },
    }));
    if (info.consoleOutput !== undefined) {
      setConsoleLogs(prev => ({ ...prev, [browserId]: info.consoleOutput! }));
    }
    if (info.consoleAppend) {
      setConsoleLogs(prev => ({
        ...prev,
        [browserId]: (prev[browserId] ?? '') + info.consoleAppend,
      }));
    }
    // Update tab list in the session entry when the stream reports a change.
    if (info.tabs !== undefined) {
      setSessions(prev => prev.map(s =>
        s.id === browserId
          ? { ...s, tabs: info.tabs!, activeTabIndex: info.activeTabIndex ?? 0 }
          : s,
      ));
    }
  }, []);

  // ── Navigate to URL ───────────────────────────────────────────────────────
  const handleNavigate = useCallback(async (id: string, url: string) => {
    const trimmed = url.trim();
    if (!trimmed || navigating) return;
    let finalUrl = trimmed;
    if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(finalUrl)) finalUrl = `https://${finalUrl}`;
    setNavigating(true);
    try {
      await adapter.navigate(id, finalUrl, { waitUntil: 'domcontentloaded', sessionId });
      // The WS stream will push the updated URL/title via the next info message.
    } catch { /* navigation errors are visible on the live stream */ }
    finally {
      setNavigating(false);
    }
  }, [adapter, navigating, sessionId]);

  // ── Execute JS ────────────────────────────────────────────────────────────
  const handleRunJs = useCallback(async (id: string) => {
    const script = jsInput.trim();
    if (!script || jsRunning) return;
    setJsRunning(true);
    setJsResult(null);
    try {
      const result = await adapter.evaluate(id, script, sessionId);
      const text = result === undefined ? '(undefined)'
        : result === null ? '(null)'
        : typeof result === 'object' ? JSON.stringify(result, null, 2)
        : String(result);
      setJsResult(`\u2713 ${text}`);
    } catch (err) {
      setJsResult(`\u2717 ${String(err)}`);
    } finally {
      setJsRunning(false);
    }
  }, [adapter, jsInput, jsRunning, sessionId]);

  // ── Side-effects ──────────────────────────────────────────────────────────
  useEffect(() => {
    setJsResult(null);
    setJsInput('');
  }, [validSelectedId]);

  // Sync addr bar when switching sessions (always).
  useEffect(() => {
    if (validSelectedId) setAddrInput(pageInfo[validSelectedId]?.url ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validSelectedId]);

  // Sync addr bar when page navigates, but only if user is not actively typing.
  useEffect(() => {
    if (!addrFocusedRef.current && validSelectedId)
      setAddrInput(pageInfo[validSelectedId]?.url ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageInfo]);

  useEffect(() => {
    if (showNewBar) urlInputRef.current?.focus();
  }, [showNewBar]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedEntry = sessions.find(s => s.id === validSelectedId) ?? null;
  const info = validSelectedId ? (pageInfo[validSelectedId] ?? null) : null;
  const log  = validSelectedId ? (consoleLogs[validSelectedId] ?? '') : '';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles['panel']}>
      <BrowserTabBar
        sessions={sessions}
        selectedId={validSelectedId}
        creating={creating}
        showNewBar={showNewBar}
        urlInput={urlInput}
        useProxy={useProxy}
        newSessionConfig={newSessionConfig}
        urlInputRef={urlInputRef}
        onSelect={setSelectedId}
        onClose={handleClose}
        onCreate={handleCreate}
        onShowNewBar={setShowNewBar}
        onUrlChange={setUrlInput}
        onUseProxyChange={setUseProxy}
        onNewSessionConfigChange={setNewSessionConfig}
      />

      {selectedEntry ? (
        <BrowserSessionView
          key={selectedEntry.id}
          entry={selectedEntry}
          adapter={adapter}
          browserId={selectedEntry.id}
          addrInput={addrInput}
          navigating={navigating}
          info={info}
          log={log}
          jsInput={jsInput}
          jsRunning={jsRunning}
          jsResult={jsResult}
          consoleEndRef={consoleEndRef}
          jsInputRef={jsInputRef}
          onAddrChange={setAddrInput}
          onAddrFocus={() => { addrFocusedRef.current = true; }}
          onAddrBlur={() => { addrFocusedRef.current = false; }}
          onNavigate={() => handleNavigate(validSelectedId!, addrInput)}
          onPageInfo={(i) => handlePageInfo(validSelectedId!, i)}
          onToggleProxy={() => handleToggleProxy(validSelectedId!)}
          tabs={selectedEntry.tabs}
          activeTabIndex={selectedEntry.activeTabIndex}
          onSwitchTab={(idx) => handleSwitchTab(validSelectedId!, idx)}
          onApplyConfig={(cfg) => handleApplyConfig(validSelectedId!, cfg)}
          configApplying={configApplying}
          onJsChange={setJsInput}
          onRunJs={() => handleRunJs(validSelectedId!)}
          streamConfig={streamConfig}
          onStreamConfigChange={handleStreamConfigChange}
          viewport={viewport}
          onViewportResize={handleViewportResize}
        />
      ) : (
        <div className={styles['empty-state']}>
          <div className={styles['empty-icon']}>{String.fromCodePoint(0x1F310)}</div>
          <div className={styles['empty-msg']}>No browser sessions open</div>
          <div className={styles['empty-hint']}>
            Click <strong>+</strong> to launch a new Playwright browser session
          </div>
        </div>
      )}
    </div>
  );
}
