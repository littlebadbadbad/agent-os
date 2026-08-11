/**
 * BrowserConsole — DOM-based console log viewer with inline JS evaluation.
 *
 * Features:
 *   - ANSI-coloured log lines (via anser)
 *   - Per-tab isolation via tabKey
 *   - Inline REPL input bar with result display
 *   - Auto-scroll to bottom on new content
 *   - Focuses input only on first mount, never steals focus afterwards
 */

import { useEffect, useRef, useMemo, useState, useCallback, type ReactElement, type KeyboardEvent } from 'react';
import Anser from 'anser';
import type { BrowserAdapter } from '../agent/types';
import { formatEvalResult, formatEvalError } from './evalFormatter';
import styles from './BrowserPanel.module.scss';

const MAX_LINES = 500;

export interface BrowserConsoleProps {
  /** Raw console text (plain or with ANSI markers). */
  text: string;
  /** Identity key for the current tab within a session. Resets eval result. */
  tabKey: string;
  /** Browser adapter for evaluate(). */
  adapter: BrowserAdapter;
  /** Browser session id. */
  browserId: string;
  /** Whether the session is alive (disables input when false). */
  alive: boolean;
  /** Called when evaluation output should be appended to the persistent log. */
  onAppendToLog: (text: string) => void;
}

export function BrowserConsole({
  text,
  tabKey,
  adapter,
  browserId,
  alive,
  onAppendToLog,
}: BrowserConsoleProps): ReactElement {
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFocusedRef = useRef(false);

  const [evalInput, setEvalInput] = useState('');
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalResult, setEvalResult] = useState<string | null>(null);

  // Focus input on first mount only — never steal focus afterwards.
  useEffect(() => {
    if (!hasFocusedRef.current && inputRef.current) {
      inputRef.current.focus();
      hasFocusedRef.current = true;
    }
  }, []);

  // Clear eval result when tab changes.
  useEffect(() => {
    setEvalResult(null);
  }, [tabKey]);

  // Auto-scroll to bottom on new log content.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [text]);

  // Parse ANSI lines — use stable index-based keys for React reconciliation.
  const lines = useMemo(() => {
    const raw = text.split('\n');
    const slice = raw.length > MAX_LINES ? raw.slice(-MAX_LINES) : raw;
    return slice.map((line, i) => ({
      key: i,
      html: Anser.ansiToHtml(line, { use_classes: true }),
    }));
  }, [text]);

  const handleRun = useCallback(async () => {
    const script = evalInput.trim();
    if (!script || evalRunning) return;
    setEvalRunning(true);
    setEvalResult(null);
    onAppendToLog(`> ${script}\n`);
    try {
      const result = await adapter.evaluate(browserId, script);
      const formatted = formatEvalResult(result);
      setEvalResult(formatted);
      onAppendToLog(`${formatted}\n`);
    } catch (err: unknown) {
      const formatted = formatEvalError(err);
      setEvalResult(formatted);
      onAppendToLog(`${formatted}\n`);
    } finally {
      setEvalRunning(false);
      setEvalInput('');
    }
  }, [evalInput, evalRunning, adapter, browserId, onAppendToLog]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleRun();
    },
    [handleRun],
  );

  return (
    <>
      {/* Scrollable log */}
      <div className={styles['console-log']}>
        {lines.map(({ key, html }) => (
          <div
            key={key}
            className={styles['console-line']}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ))}
        <div ref={logEndRef} />
      </div>

      {/* Input bar with Run button */}
      <div className={styles['console-input-area']}>
        <span className={styles['console-prompt']}>{'\u203A'}</span>
        <input
          ref={inputRef}
          className={styles['console-input-field']}
          type="text"
          value={evalInput}
          onChange={(e) => setEvalInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="document.title  /  window.scrollY  /  …"
          disabled={!alive || evalRunning}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className={styles['js-run-btn']}
          onClick={handleRun}
          disabled={!alive || evalRunning || !evalInput.trim()}
          title="Run JS (Enter)"
        >
          {evalRunning ? '\u2026' : 'Run'}
        </button>
      </div>

      {/* Inline evaluation result */}
      {evalResult !== null && (
        <div
          className={`${styles['js-result']}${
            evalResult.startsWith('\u2717') ? ` ${styles['js-result--error']}` : ''
          }`}
        >
          {evalResult}
        </div>
      )}
    </>
  );
}
