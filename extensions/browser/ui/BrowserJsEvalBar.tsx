/**
 * extensions/browser/ui/BrowserJsEvalBar.tsx
 *
 * JavaScript evaluation bar for a single browser session.
 * Extracted from BrowserSessionView for modularity.
 *
 * Provides a text input to run arbitrary JS in the browser page,
 * with result display below the bar.
 */

import { useState, useRef, useCallback, type ReactElement } from 'react';
import type { BrowserAdapter } from '../agent/types';
import styles from './BrowserPanel.module.scss';

export interface BrowserJsEvalBarProps {
  /** Browser adapter for evaluate(). */
  adapter: BrowserAdapter;
  /** Browser session id. */
  browserId: string;
  /** Whether the session is alive. */
  alive: boolean;
}

/**
 * JS evaluation bar with input field, Run button, and result display.
 */
export function BrowserJsEvalBar({
  adapter,
  browserId,
  alive,
}: BrowserJsEvalBarProps): ReactElement {
  const [jsInput, setJsInput] = useState('');
  const [jsRunning, setJsRunning] = useState(false);
  const [jsResult, setJsResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleRun = useCallback(async () => {
    const script = jsInput.trim();
    if (!script || jsRunning) return;
    setJsRunning(true);
    setJsResult(null);
    try {
      const result = await adapter.evaluate(browserId, script);
      const text = result === undefined
        ? '(undefined)'
        : result === null
          ? '(null)'
          : typeof result === 'object'
            ? JSON.stringify(result, null, 2)
            : String(result);
      setJsResult(`\u2713 ${text}`);
    } catch (err) {
      setJsResult(`\u2717 ${String(err)}`);
    } finally {
      setJsRunning(false);
    }
  }, [adapter, jsInput, jsRunning, browserId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleRun();
    },
    [handleRun],
  );

  return (
    <>
      <div className={styles['js-bar']}>
        <span className={styles['js-bar-label']}>JS\u203A</span>
        <input
          ref={inputRef}
          className={styles['js-input']}
          type="text"
          value={jsInput}
          onChange={(e) => setJsInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="document.title  /  window.scrollY  /  \u2026"
          disabled={!alive || jsRunning}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className={styles['js-run-btn']}
          onClick={handleRun}
          disabled={!alive || jsRunning || !jsInput.trim()}
          title="Run JS (Enter)"
        >
          {jsRunning ? '\u2026' : 'Run'}
        </button>
      </div>

      {jsResult !== null && (
        <div
          className={`${styles['js-result']}${
            jsResult.startsWith('\u2717') ? ` ${styles['js-result--error']}` : ''
          }`}
        >
          {jsResult}
        </div>
      )}
    </>
  );
}
