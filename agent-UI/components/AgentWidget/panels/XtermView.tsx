import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalEntry, TerminalManagerAdapter } from '@agent-sdk';
import styles from './TerminalPanel.module.scss';

/**
 * Measure terminal cell dimensions via DOM probes.
 *
 * xterm.js renders a `.xterm-char-measure-element` in its element tree.
 * We read its `getBoundingClientRect()` to determine cell width/height
 * without accessing underscore-prefixed private internals.
 */
function measureCell(term: Terminal): { width: number; height: number } | null {
  const el = term.element;
  if (!el) return null;
  // xterm.js inserts an inline element for char measurement inside .xterm-screen
  const screen = el.querySelector('.xterm-screen');
  if (!screen) return null;
  const { width, height } = screen.getBoundingClientRect();
  if (!width || !height || !term.cols || !term.rows) return null;
  return {
    width: width / term.cols,
    height: height / term.rows,
  };
}

interface XtermViewProps {
  entry: TerminalEntry;
  adapter: TerminalManagerAdapter;
  sessionId: string;
  onExited: (id: string, exitCode?: number) => void;
}

export function XtermView({ entry, adapter, sessionId, onExited }: XtermViewProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const [running,  setRunning]  = useState(entry.running);
  const [exitCode, setExitCode] = useState<number | undefined>(entry.exitCode);

  // ── Mount / destroy xterm on terminal-id change ───────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono','Cascadia Code','Fira Code','Consolas',monospace",
      theme: { background: '#0d1117', foreground: '#c9d1d9' },
    });
    termRef.current = term;
    term.open(container);

    const disposeInput = term.onData(data => {
      adapter.sendInput(entry.id, data, sessionId).catch(() => {});
    });

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
      adapter.readOutput(entry.id, 0, sessionId)
        .then(r => { if (r.output) term.write(r.output); })
        .catch(() => {});
    }

    return () => {
      disposeInput.dispose();
      stopStream?.();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  // ── PTY resize via ResizeObserver + DOM cell measurement ─────────────────
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

  return (
    <div className={styles['terminal-view']}>
      {!running && (
        <div className={styles['exited-banner']}>
          Process exited ({exitCode ?? '?'})
        </div>
      )}
      <div ref={containerRef} className={styles['xterm-container']} />
    </div>
  );
}
