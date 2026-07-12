/**
 * extensions/terminal/ui/TerminalPanel.tsx
 *
 * Main terminal panel UI — tab bar, create/remove, shell picker.
 * Adapted from agent-UI version for plugin use.
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
  const [creating, setCreating]     = useState(false);
  const [showNewBar, setShowNewBar] = useState(false);
  const [shellInput, setShellInput] = useState('');
  const [cwdInput, setCwdInput]     = useState('');
  const [availableShells, setAvailableShells] = useState<AvailableShell[]>([]);
  const shellInputRef = useRef<HTMLInputElement>(null);

  // ── Initial load ──
  useEffect(() => {
    adapter.listTerminals({ sessionId }).then(list => {
      setTerminals(list);
      if (list.length > 0) setSelectedId(list[0].id);
    }).catch(() => {});
    adapter.listShells().then(setAvailableShells).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Periodic sync (3 s) ────────────────────────────────────────────────────
  useEffect(() => {
    const intervalId = setInterval(async () => {
      try {
        const list = await adapter.listTerminals({ sessionId });
        setTerminals(prev =>
          prev
            .filter(t => list.some(l => l.id === t.id))
            .map(t => {
              const fresh = list.find(l => l.id === t.id);
              return fresh ? { ...t, running: fresh.running, exitCode: fresh.exitCode } : t;
            }),
        );
      } catch {
        // backend may be restarting
      }
    }, 3000);
    return () => clearInterval(intervalId);
  }, [adapter, sessionId]);

  // ── Derive valid selected id ────────────────────────────────────────────────
  const validSelectedId: string | null =
    terminals.some(t => t.id === selectedId)
      ? selectedId
      : terminals.length > 0
        ? terminals[terminals.length - 1].id
        : null;

  // ── Create terminal ─────────────────────────────────────────────────────────
  const handleCreate = useCallback(async (shell?: string, cwd?: string) => {
    if (creating) return;
    setCreating(true);
    setShowNewBar(false);
    setShellInput('');
    setCwdInput('');
    try {
      const opts: { shell?: string; cwd?: string } = {};
      if (shell) opts.shell = shell;
      if (cwd)   opts.cwd   = cwd;
      const newEntry = await adapter.createTerminal({ ...opts, sessionId });
      setTerminals(prev => [...prev, newEntry]);
      setSelectedId(newEntry.id);
    } catch {
      // silently ignore
    } finally {
      setCreating(false);
    }
  }, [adapter, creating, sessionId]);

  // ── Remove terminal ─────────────────────────────────────────────────────────
  const handleRemove = useCallback(async (id: string) => {
    try { await adapter.removeTerminal(id, sessionId); } catch {}
    setTerminals(prev => prev.filter(t => t.id !== id));
    setSelectedId(prev => prev === id ? null : prev);
  }, [adapter, sessionId]);

  // ── Terminal exited ─────────────────────────────────────────────────────────
  const handleExited = useCallback((id: string, code?: number) => {
    setTerminals(prev =>
      prev.map(t => t.id === id ? { ...t, running: false, exitCode: code } : t),
    );
  }, []);

  // ── New-bar focus ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (showNewBar) shellInputRef.current?.focus();
  }, [showNewBar]);

  // ── Derive selected entry ───────────────────────────────────────────────────
  const selectedEntry = terminals.find(t => t.id === validSelectedId) ?? null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={styles['panel']}>
      {/* Tab bar */}
      <div className={styles['tab-bar']}>
        <span className={styles['tab-bar-title']}>Terminal</span>
        <div className={styles['tab-list']}>
          {terminals.map(t => (
            <button
              key={t.id}
              className={`${styles['tab']} ${t.id === validSelectedId ? styles['tab--active'] : ''}`}
              onClick={() => setSelectedId(t.id)}
              title={t.label}
            >
              <span className={styles['tab-label']}>{t.label}</span>
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
          title="New terminal"
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
        />
      )}
      {!selectedEntry && (
        <div className={styles['empty-state']}>
          No terminals. Click + to create one.
        </div>
      )}
    </div>
  );
}
