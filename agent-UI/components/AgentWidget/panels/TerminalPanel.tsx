import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactElement,
} from 'react';
import type { TerminalManagerAdapter, TerminalEntry, AvailableShell } from '@agent-sdk';
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
    // Load available shells once for the shell-picker autocomplete datalist.
    adapter.listShells().then(setAvailableShells).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Periodic sync (3 s) — picks up status changes from other sources ─────
  useEffect(() => {
    const intervalId = setInterval(async () => {
      try {
        const list = await adapter.listTerminals({ sessionId });
        setTerminals(prev =>
          // Update running/exitCode; remove any externally-deleted terminals.
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

  // ── Derive valid selected id (synchronous — no extra effect needed) ──
  const validSelectedId: string | null =
    terminals.some(t => t.id === selectedId)
      ? selectedId
      : terminals.length > 0
        ? terminals[terminals.length - 1].id
        : null;

  // ── Create terminal ───────────────────────────────────────────────────────
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
      // noop — silently ignore creation failures
    } finally {
      setCreating(false);
    }
  }, [adapter, creating, sessionId]);

  // ── Remove terminal ───────────────────────────────────────────────────────
  const handleRemove = useCallback(async (id: string) => {
    try { await adapter.removeTerminal(id, sessionId); } catch {}
    setTerminals(prev => prev.filter(t => t.id !== id));
    // selectedId correction is handled by validSelectedId derivation above
    setSelectedId(prev => prev === id ? null : prev);
  }, [adapter, sessionId]);

  // ── Terminal exited (from SSE done event) ─────────────────────────────────
  const handleExited = useCallback((id: string, code?: number) => {
    setTerminals(prev =>
      prev.map(t => t.id === id ? { ...t, running: false, exitCode: code } : t),
    );
  }, []);

  // ── New-bar focus ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (showNewBar) shellInputRef.current?.focus();
  }, [showNewBar]);

  // ── Derive selected entry ─────────────────────────────────────────────────
  const selectedEntry = terminals.find(t => t.id === validSelectedId) ?? null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles['panel']}>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className={styles['tab-bar']}>
        <span className={styles['tab-bar-title']}>Terminal</span>

        {terminals.map(t => (
          <button
            key={t.id}
            type="button"
            className={`${styles['tab']}${t.id === validSelectedId ? ` ${styles['tab--active']}` : ''}`}
            onClick={() => setSelectedId(t.id)}
            title={`${t.label} (${t.shell})`}
          >
            <span
              className={`${styles['tab-dot']}${
                t.running ? ` ${styles['tab-dot--running']}` : ` ${styles['tab-dot--exited']}`
              }`}
            />
            <span className={styles['tab-label']}>{t.label}</span>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
            <span
              className={styles['tab-close']}
              role="button"
              tabIndex={-1}
              title="Close terminal"
              onClick={e => { e.stopPropagation(); handleRemove(t.id); }}
            >
              ×
            </span>
          </button>
        ))}

        {/* ── New-terminal bar or + button ── */}
        {showNewBar ? (
          <div className={styles['new-bar']}>
            <input
              ref={shellInputRef}
              className={styles['new-bar-input']}
              type="text"
              list="asdk-terminal-shells"
              value={shellInput}
              onChange={e => setShellInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  handleCreate(shellInput.trim() || undefined, cwdInput.trim() || undefined);
                if (e.key === 'Escape') { setShowNewBar(false); setShellInput(''); setCwdInput(''); }
              }}
              placeholder="Shell (blank = default)"
              autoComplete="off"
            />
            <datalist id="asdk-terminal-shells">
              {availableShells.map(s => (
                <option key={s.name} value={s.name}>
                  {s.path}{s.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </datalist>
            <input
              className={styles['new-bar-cwd']}
              type="text"
              value={cwdInput}
              onChange={e => setCwdInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  handleCreate(shellInput.trim() || undefined, cwdInput.trim() || undefined);
                if (e.key === 'Escape') { setShowNewBar(false); setShellInput(''); setCwdInput(''); }
              }}
              placeholder="Working dir (blank = default)"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className={styles['new-bar-confirm']}
              onClick={() => handleCreate(shellInput.trim() || undefined, cwdInput.trim() || undefined)}
              disabled={creating}
            >
              Open
            </button>
            <button
              type="button"
              className={styles['new-bar-cancel']}
              onClick={() => { setShowNewBar(false); setShellInput(''); setCwdInput(''); }}
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles['add-tab-btn']}
            onClick={() => setShowNewBar(true)}
            title="New terminal (click to choose shell)"
            disabled={creating}
          >
            +
          </button>
        )}
      </div>

      {/* ── Content area ─────────────────────────────────────────────────── */}
      {selectedEntry ? (
        <XtermView
          key={selectedEntry.id}
          entry={selectedEntry}
          adapter={adapter}
          sessionId={sessionId}
          onExited={handleExited}
        />
      ) : (
        <div className={styles['empty-state']}>
          <div className={styles['empty-icon']}>▶_</div>
          <div className={styles['empty-msg']}>No terminals open</div>
          <div className={styles['empty-hint']}>
            Click <strong>+</strong> in the tab bar to start a new terminal
          </div>
        </div>
      )}
    </div>
  );
}

