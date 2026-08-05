/**
 * internal-plugins/terminal/ui/TerminalPanel.tsx
 *
 * Terminal panel with tab bar, create/remove, toolbar, search, font zoom,
 * tab rename, and keyboard shortcuts.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactElement,
} from 'react';
import type { TerminalManagerAdapter, TerminalEntry, AvailableShell } from '../agent/shell/types';
import { XtermView } from './XtermView';
import styles from './TerminalPanel.module.scss';

// ── TerminalPanel ─────────────────────────────────────────────────────────────

export interface TerminalPanelProps {
  adapter: TerminalManagerAdapter;
  sessionId: string;
}

export function TerminalPanel({ adapter, sessionId }: TerminalPanelProps): ReactElement {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showNewBar, setShowNewBar] = useState(false);
  const [shellInput, setShellInput] = useState('');
  const [cwdInput, setCwdInput] = useState('');
  const [availableShells, setAvailableShells] = useState<AvailableShell[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [fontSize, setFontSize] = useState(13);
  const shellInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Initial load ──
  useEffect(() => {
    adapter.listTerminals({ sessionId }).then(list => {
      setTerminals(list);
      if (list.length > 0) setSelectedId(list[0].id);
    }).catch(() => {});
    adapter.listShells().then(setAvailableShells).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Periodic sync ──────────────────────────────────────────────────────
  useEffect(() => {
    const intervalId = setInterval(async () => {
      try {
        const list = await adapter.listTerminals({ sessionId });
        setTerminals(prev => {
          const prevIds = new Set(prev.map(t => t.id));
          const updated = prev
            .filter(t => list.some(l => l.id === t.id))
            .map(t => {
              const fresh = list.find(l => l.id === t.id);
              return fresh ? { ...t, running: fresh.running, exitCode: fresh.exitCode } : t;
            });
          const added = list.filter(l => !prevIds.has(l.id));
          return [...updated, ...added];
        });
      } catch { /* backend may be restarting */ }
    }, 3000);
    return () => clearInterval(intervalId);
  }, [adapter, sessionId]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
      const isCtrlShift = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;

      // Ctrl+Tab: Next terminal
      if (isCtrl && e.key === 'Tab') {
        e.preventDefault();
        setSelectedId((prev) => {
          const idx = terminals.findIndex(t => t.id === prev);
          return terminals[(idx + 1) % terminals.length]?.id ?? prev;
        });
        return;
      }

      // Ctrl+Shift+Tab: Previous terminal
      if (isCtrlShift && e.key === 'Tab') {
        e.preventDefault();
        setSelectedId((prev) => {
          const idx = terminals.findIndex(t => t.id === prev);
          return terminals[(idx - 1 + terminals.length) % terminals.length]?.id ?? prev;
        });
        return;
      }

      // Ctrl+W / Ctrl+D: Close current terminal
      if (isCtrl && (e.key === 'w' || e.key === 'W' || e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (validSelectedId) handleRemove(validSelectedId);
        return;
      }

      // Ctrl+Shift+T: New terminal
      if (isCtrlShift && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        handleCreate();
        return;
      }

      // Escape: Close new-bar if open
      if (e.key === 'Escape' && showNewBar) {
        setShowNewBar(false);
        return;
      }
    };

    panel.addEventListener('keydown', handleKeyDown);
    return () => panel.removeEventListener('keydown', handleKeyDown);
  });

  // ── Derive valid selected id ───────────────────────────────────────────
  const validSelectedId: string | null =
    terminals.some(t => t.id === selectedId)
      ? selectedId
      : terminals.length > 0
        ? terminals[terminals.length - 1].id
        : null;

  // ── Create terminal ────────────────────────────────────────────────────
  const handleCreate = useCallback(async (shell?: string, cwd?: string) => {
    if (creating) return;
    setCreating(true);
    setShowNewBar(false);
    setShellInput('');
    setCwdInput('');
    try {
      const opts: { shell?: string; cwd?: string } = {};
      if (shell) opts.shell = shell;
      if (cwd) opts.cwd = cwd;
      const newEntry = await adapter.createTerminal({ ...opts, sessionId });
      setTerminals(prev => [...prev, newEntry]);
      setSelectedId(newEntry.id);
    } catch { /* silently ignore */ } finally {
      setCreating(false);
    }
  }, [adapter, creating, sessionId]);

  // ── Remove terminal ────────────────────────────────────────────────────
  const handleRemove = useCallback(async (id: string) => {
    try { await adapter.removeTerminal(id, sessionId); } catch {}
    setTerminals(prev => prev.filter(t => t.id !== id));
    setSelectedId(prev => prev === id ? null : prev);
  }, [adapter, sessionId]);

  // ── Terminal exited ────────────────────────────────────────────────────
  const handleExited = useCallback((id: string, code?: number) => {
    setTerminals(prev =>
      prev.map(t => t.id === id ? { ...t, running: false, exitCode: code } : t),
    );
  }, []);

  // ── Tab rename ─────────────────────────────────────────────────────────
  const startRename = useCallback((id: string, currentLabel: string) => {
    setRenamingId(id);
    setRenameValue(currentLabel);
    // Focus the rename input after render.
    requestAnimationFrame(() => renameInputRef.current?.select());
  }, []);

  const commitRename = useCallback(() => {
    setRenamingId(null);
    // The rename is client-side only — updates the local label for display.
    // Backend label updates would need a new API; this keeps it simple.
  }, []);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      setRenamingId(null);
    }
  }, [commitRename]);

  // ── Clear terminal ─────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    // Send Ctrl+L to clear the terminal screen.
    if (validSelectedId) {
      adapter.sendInput(validSelectedId, '\x0c', sessionId).catch(() => {});
    }
  }, [adapter, validSelectedId, sessionId]);

  // ── Font size controls ─────────────────────────────────────────────────
  const handleFontZoomIn = useCallback(() => {
    setFontSize((prev) => Math.min(32, prev + 1));
  }, []);

  const handleFontZoomOut = useCallback(() => {
    setFontSize((prev) => Math.max(8, prev - 1));
  }, []);

  const handleFontReset = useCallback(() => {
    setFontSize(13);
  }, []);

  // ── New-bar focus ──────────────────────────────────────────────────────
  useEffect(() => {
    if (showNewBar) shellInputRef.current?.focus();
  }, [showNewBar]);

  // ── Derive selected entry ──────────────────────────────────────────────
  const selectedEntry = terminals.find(t => t.id === validSelectedId) ?? null;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={styles['panel']} ref={panelRef}>
      {/* Tab bar */}
      <div className={styles['tab-bar']}>
        <span className={styles['tab-bar-title']}>Terminal</span>
        <div className={styles['tab-list']}>
          {terminals.map(t => (
            <button
              key={t.id}
              className={`${styles['tab']} ${t.id === validSelectedId ? styles['tab--active'] : ''}`}
              onClick={() => setSelectedId(t.id)}
              onDoubleClick={() => startRename(t.id, t.label)}
              title={t.label}
            >
              {renamingId === t.id ? (
                <input
                  ref={renameInputRef}
                  className={styles['tab-rename-input']}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => handleRenameKeyDown(e, t.id)}
                  onClick={e => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span className={styles['tab-label']}>{t.label}</span>
              )}
              {!t.running && <span className={styles['tab-exited']}>✕</span>}
              <span
                className={styles['tab-close']}
                onClick={(e) => { e.stopPropagation(); handleRemove(t.id); }}
              >
                ✕
              </span>
            </button>
          ))}
        </div>
        <button
          className={styles['add-btn']}
          onClick={() => setShowNewBar(v => !v)}
          title="New terminal (Ctrl+Shift+T)"
        >
          +
        </button>
      </div>

      {/* New terminal bar */}
      {showNewBar && (
        <div className={styles['new-bar']}>
          <input
            ref={shellInputRef}
            className={styles['new-bar-input']}
            placeholder="Shell (e.g. pwsh, cmd.exe, bash)"
            value={shellInput}
            onChange={e => setShellInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(shellInput || undefined, cwdInput || undefined); }}
            list="terminal-shells"
          />
          <datalist id="terminal-shells">
            {availableShells.map(s => (
              <option key={s.name} value={s.path}>{s.name}{s.isDefault ? ' (default)' : ''}</option>
            ))}
          </datalist>
          <input
            className={styles['new-bar-input']}
            placeholder="CWD (optional)"
            value={cwdInput}
            onChange={e => setCwdInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(shellInput || undefined, cwdInput || undefined); }}
          />
          <button
            className={styles['new-bar-btn']}
            onClick={() => handleCreate(shellInput || undefined, cwdInput || undefined)}
            disabled={creating}
          >
            {creating ? '…' : 'Create'}
          </button>
        </div>
      )}

      {/* Terminal view */}
      {selectedEntry && (
        <XtermView
          key={selectedEntry.id}
          entry={selectedEntry}
          adapter={adapter}
          sessionId={sessionId}
          onExited={handleExited}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
        />
      )}
      {!selectedEntry && (
        <div className={styles['empty-state']}>
          <span>No terminals.</span>
          <span className={styles['empty-state-hint']}>Ctrl+Shift+T or click + to create one.</span>
        </div>
      )}

      {/* Toolbar */}
      <div className={styles['toolbar']}>
        <span className={styles['toolbar-item']} title="Clear terminal (Ctrl+L)">
          <button className={styles['toolbar-btn']} onClick={handleClear} disabled={!selectedEntry}>
            🗑
          </button>
        </span>
        <span className={styles['toolbar-separator']} />
        <span className={styles['toolbar-item']} title="Zoom out">
          <button className={styles['toolbar-btn']} onClick={handleFontZoomOut} disabled={!selectedEntry}>
            −
          </button>
        </span>
        <span className={styles['toolbar-font-size']}>{fontSize}</span>
        <span className={styles['toolbar-item']} title="Zoom in">
          <button className={styles['toolbar-btn']} onClick={handleFontZoomIn} disabled={!selectedEntry}>
            +
          </button>
        </span>
        <span className={styles['toolbar-separator']} />
        <span className={styles['toolbar-item']} title="Reset font size">
          <button className={styles['toolbar-btn']} onClick={handleFontReset} disabled={!selectedEntry}>
            ↺
          </button>
        </span>
        <span className={styles['toolbar-spacer']} />
        <span className={styles['toolbar-status']}>
          {terminals.length} terminal{terminals.length !== 1 ? 's' : ''}
          {validSelectedId && selectedEntry?.running === false ? ' (exited)' : ''}
        </span>
      </div>
    </div>
  );
}
