/**
 * extensions/browser/ui/BrowserConsole.tsx — xterm.js-based browser console
 *
 * Replaces the plain <pre> console area with a proper terminal emulator:
 *   - ANSI-colored log levels (info/warn/error)
 *   - Auto-scroll to bottom
 *   - Resize-aware via FitAddon
 *   - Dark terminal theme matching the host UI
 *
 * Only ever receives the ACTIVE tab's console output — isolation is
 * handled by the backend (per-page buffers in BrowserInstance).
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ReactElement } from 'react';

// ── ANSI helpers ────────────────────────────────────────────────────────────

const ANSI = {
  reset:  '\x1b[0m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  cyan:   '\x1b[36m',
  grey:   '\x1b[90m',
  bold:   '\x1b[1m',
};

/** Map Playwright console types to ANSI colors. */
const LEVEL_COLORS: Record<string, string> = {
  log:     '',
  info:    ANSI.blue,
  warn:    ANSI.yellow,
  error:   ANSI.red,
  debug:   ANSI.grey,
  pageerror: ANSI.red + ANSI.bold,
  download:  ANSI.cyan,
};

/**
 * Render a console log line with ANSI color coding.
 * Wraps the leading [type] tag in color.
 */
function colorizeLine(line: string): string {
  const match = line.match(/^\[(\w+)\]/);
  if (!match) return line;
  const level = match[1];
  const color = LEVEL_COLORS[level] ?? '';
  if (!color) return line;
  const rest = line.slice(match[0].length);
  return `${color}${match[0]}${ANSI.reset}${rest}`;
}

// ── Theme ────────────────────────────────────────────────────────────────────

const TERMINAL_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor:     '#c9d1d9',
  selectionBackground: '#3b5998',
  black:      '#484f58',
  red:        '#ff7b72',
  green:      '#3fb950',
  yellow:     '#d29922',
  blue:       '#58a6ff',
  magenta:    '#bc8cff',
  cyan:       '#39c5cf',
  white:      '#b1bac4',
  brightBlack:  '#6e7681',
  brightRed:    '#ffa198',
  brightGreen:  '#56d364',
  brightYellow: '#e3b341',
  brightBlue:   '#79c0ff',
  brightMagenta:'#d2a8ff',
  brightCyan:   '#56d4dd',
  brightWhite:  '#f0f6fc',
};

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_LINES = 500;

// ── Component ────────────────────────────────────────────────────────────────

export interface BrowserConsoleProps {
  /** Raw console text (plain or with ANSI markers). */
  text: string;
}

export function BrowserConsole({ text }: BrowserConsoleProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef  = useRef<Terminal | null>(null);
  const fitAddonRef  = useRef<FitAddon | null>(null);
  const lastTextRef  = useRef('');

  // ── Init xterm ──────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontSize: 11,
      fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', 'Menlo', monospace",
      lineHeight: 1.35,
      cursorBlink: false,
      cursorStyle: 'underline',
      disableStdin: true,
      allowProposedApi: true,
      rows: 5,
      cols: 80,
      scrollback: MAX_LINES,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(container);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Re-fit on resize.
    const observer = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* not mounted */ }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // ── Update content ──────────────────────────────────────────────────────
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;

    const prev = lastTextRef.current;
    if (prev === text) return;

    // If text was reset (tab switch), clear and rewrite all.
    if (text.length < prev.length || !prev) {
      term.reset();
      const lines = text.split('\n');
      // Only write last MAX_LINES to avoid memory issues.
      const slice = lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
      for (const line of slice) {
        term.writeln(colorizeLine(line));
      }
    } else {
      // Append only the new portion.
      const diff = text.slice(prev.length);
      const lines = diff.split('\n');
      for (const line of lines) {
        if (line) term.writeln(colorizeLine(line));
      }
    }

    lastTextRef.current = text;
  }, [text]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  );
}
