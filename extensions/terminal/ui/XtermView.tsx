/**
 * extensions/terminal/ui/XtermView.tsx
 *
 * xterm.js terminal emulator with search, copy/paste, font zoom,
 * and full keyboard shortcut support.
 */

import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react';
import { Terminal } from '@xterm/xterm';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import type { TerminalEntry, TerminalManagerAdapter } from '../agent/shell/types';
import styles from './TerminalPanel.module.scss';

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

// ── Helpers ───────────────────────────────────────────────────────────────────

function measureCell(term: Terminal): { width: number; height: number } | null {
  const el = term.element;
  if (!el) return null;
  const screen = el.querySelector('.xterm-screen') as HTMLElement | null;
  if (!screen) return null;
  const { width, height } = screen.getBoundingClientRect();
  if (!width || !height || !term.cols || !term.rows) return null;
  return {
    width: width / term.cols,
    height: height / term.rows,
  };
}

function clipFontSize(size: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface XtermViewProps {
  entry: TerminalEntry;
  adapter: TerminalManagerAdapter;
  sessionId: string;
  onExited: (id: string, exitCode?: number) => void;
  /** Exposed so TerminalPanel can reset font size on tab switch. */
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function XtermView({
  entry,
  adapter,
  sessionId,
  onExited,
  fontSize: controlledFontSize,
  onFontSizeChange,
}: XtermViewProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [running, setRunning] = useState(entry.running);
  const [exitCode, setExitCode] = useState<number | undefined>(entry.exitCode);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fontSize, setFontSize] = useState(controlledFontSize ?? 13);

  // Sync font size from parent when it changes.
  useEffect(() => {
    if (controlledFontSize !== undefined) {
      setFontSize(controlledFontSize);
    }
  }, [controlledFontSize]);

  // Apply font size to xterm instance.
  const applyFontSize = useCallback((term: Terminal, size: number) => {
    const clamped = clipFontSize(size);
    term.options.fontSize = clamped;
  }, []);

  // ── Mount / destroy xterm on terminal-id change ─────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const searchAddon = new SearchAddon();
    const term = new Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily: "'SF Mono','Cascadia Code','Fira Code','Consolas',monospace",
      theme: { background: '#0d1117', foreground: '#c9d1d9' },
    });
    term.loadAddon(searchAddon);
    termRef.current = term;
    searchAddonRef.current = searchAddon;
    term.open(container);

    // ── Keyboard input → PTY stdin ──────────────────────────────────────
    const disposeInput = term.onData((data) => {
      adapter.sendInput(entry.id, data, sessionId).catch(() => {});
    });

    // ── Stream live output ───────────────────────────────────────────────
    let stopStream: (() => void) | undefined;

    if (entry.running) {
      stopStream = adapter.streamOutput(
        entry.id,
        (chunk, done, code) => {
          if (chunk) term.write(chunk);
          if (done) {
            setRunning(false);
            setExitCode(code);
            onExited(entry.id, code);
          }
        },
        sessionId,
      );
    } else {
      adapter
        .readOutput(entry.id, 0, sessionId)
        .then((r) => { if (r.output) term.write(r.output); })
        .catch(() => {});
    }

    // ── Keyboard shortcut handler ────────────────────────────────────────
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlShift = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
      const isCtrl = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;

      // Ctrl+Shift+F: Toggle search bar
      if (isCtrlShift && e.key === 'F') {
        e.preventDefault();
        e.stopPropagation();
        setShowSearch((v) => !v);
        return;
      }

      // Ctrl+Shift+C: Copy selection
      if (isCtrlShift && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
        }
        return;
      }

      // Ctrl+Shift+V: Paste from clipboard
      if (isCtrlShift && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          adapter.sendInput(entry.id, text, sessionId).catch(() => {});
        }).catch(() => {});
        return;
      }

      // Ctrl+Shift+Plus / Ctrl+=: Zoom in (both + and = keys)
      if (isCtrlShift && (e.key === '=' || e.key === 'Plus')) {
        e.preventDefault();
        const next = clipFontSize(fontSize + 1);
        applyFontSize(term, next);
        setFontSize(next);
        onFontSizeChange?.(next);
        return;
      }

      // Ctrl+Shift+Minus / Ctrl+-: Zoom out
      if (isCtrlShift && (e.key === '-' || e.key === 'Minus')) {
        e.preventDefault();
        const next = clipFontSize(fontSize - 1);
        applyFontSize(term, next);
        setFontSize(next);
        onFontSizeChange?.(next);
        return;
      }

      // Ctrl+Shift+0: Reset font size
      if (isCtrlShift && e.key === '0') {
        e.preventDefault();
        applyFontSize(term, 13);
        setFontSize(13);
        onFontSizeChange?.(13);
        return;
      }
    };

    // Auto-copy on selection (like modern terminals).
    const handleMouseUp = () => {
      const sel = term.getSelection();
      if (sel) {
        navigator.clipboard.writeText(sel).catch(() => {});
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    container.addEventListener('mouseup', handleMouseUp);

    // ── Cleanup ──────────────────────────────────────────────────────────
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      container.removeEventListener('mouseup', handleMouseUp);
      disposeInput.dispose();
      stopStream?.();
      term.dispose();
      termRef.current = null;
      searchAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  // ── PTY resize via ResizeObserver ──────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      const term = termRef.current;
      if (!term) return;
      const cell = measureCell(term);
      if (!cell) return;
      const cols = Math.max(1, Math.floor(container.clientWidth / cell.width));
      const rows = Math.max(1, Math.floor(container.clientHeight / cell.height));
      if (cols !== term.cols || rows !== term.rows) {
        term.resize(cols, rows);
        adapter.resizePty(entry.id, cols, rows, sessionId).catch(() => {});
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  // ── Search helpers ─────────────────────────────────────────────────────
  const doSearch = useCallback(
    (query: string, direction: 'next' | 'prev' = 'next') => {
      const sa = searchAddonRef.current;
      if (!sa) return;
      try {
        sa.findNext(query);
      } catch {
        // No match — SearchAddon throws when not found.
      }
    },
    [],
  );

  const handleSearchInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setSearchQuery(q);
      if (q) doSearch(q);
    },
    [doSearch],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch(searchQuery, e.shiftKey ? 'prev' : 'next');
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
        setSearchQuery('');
        termRef.current?.focus();
      }
    },
    [searchQuery, doSearch],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={styles['terminal-view']}>
      {!running && (
        <div className={styles['exited-banner']}>
          Process exited ({exitCode ?? '?'})
        </div>
      )}

      {/* Search bar */}
      {showSearch && (
        <div className={styles['search-bar']}>
          <input
            className={styles['search-input']}
            type="text"
            placeholder="Search (Enter next, Shift+Enter prev, Esc close)"
            value={searchQuery}
            onChange={handleSearchInput}
            onKeyDown={handleSearchKeyDown}
            autoFocus
          />
          <button
            className={styles['search-btn']}
            onClick={() => doSearch(searchQuery, 'prev')}
            title="Previous match"
          >
            ▲
          </button>
          <button
            className={styles['search-btn']}
            onClick={() => doSearch(searchQuery, 'next')}
            title="Next match"
          >
            ▼
          </button>
          <button
            className={styles['search-close']}
            onClick={() => { setShowSearch(false); setSearchQuery(''); termRef.current?.focus(); }}
            title="Close search"
          >
            ✕
          </button>
        </div>
      )}

      {/* xterm container */}
      <div ref={containerRef} className={styles['xterm-container']} />
    </div>
  );
}
