/**
 * extensions/browser/ui/BrowserConsole.tsx — DOM-based browser console
 *
 * Pure DOM console panel with:
 *   - ANSI-colored log lines via anser
 *   - Auto-scroll to bottom
 *   - Bottom input bar for inline REPL (when onInput is provided)
 *   - Per-tab isolation via tabKey
 *
 * No xterm.js — just <div> + <input>, zero flicker, native IME support.
 */

import { useEffect, useRef, useMemo, type ReactElement, type KeyboardEvent } from 'react';
import Anser from 'anser';
import styles from './BrowserPanel.module.scss';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_LINES = 500;

// ── Component ────────────────────────────────────────────────────────────────

export interface BrowserConsoleProps {
  /** Raw console text (plain or with ANSI markers). */
  text: string;
  /**
   * Identity key for the current tab within a session.
   * When this changes (tab switch), the console fully clears.
   */
  tabKey?: string;
  /** Called when the user types a full line and presses Enter at the prompt. */
  onInput?: (line: string) => void;
}

export function BrowserConsole({ text, tabKey, onInput }: BrowserConsoleProps): ReactElement {
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // ── Auto-scroll on new content ─────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [text]);

  // ── Focus input when in REPL mode ──────────────────────────────────────
  useEffect(() => {
    if (onInput && inputRef.current) inputRef.current.focus();
  }, [onInput, tabKey]);

  // ── Parse ANSI lines ───────────────────────────────────────────────────
  const lines = useMemo(() => {
    const raw = text.split('\n');
    const slice = raw.length > MAX_LINES ? raw.slice(-MAX_LINES) : raw;
    return slice.map((line) => {
      const html = Anser.ansiToHtml(line, { use_classes: true });
      return { key: crypto?.randomUUID?.() ?? Math.random().toString(36), html };
    });
  }, [text]);

  // ── Handle Enter key in input bar ───────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onInput) {
      const value = inputRef.current?.value ?? '';
      inputRef.current!.value = '';
      onInput(value);
    }
  };

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

      {/* Input bar — only when onInput is provided */}
      {onInput && (
        <div className={styles['console-input-area']}>
          <span className={styles['console-prompt']}>{'\u203A'}</span>
          <input
            ref={inputRef}
            className={styles['console-input-field']}
            type="text"
            onKeyDown={handleKeyDown}
            placeholder="Type JavaScript and press Enter to evaluate"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}
    </>
  );
}
