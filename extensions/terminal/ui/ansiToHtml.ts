/**
 * extensions/terminal/ui/ansiToHtml.ts — ANSI/VT100 to HTML renderer
 *
 * Converts raw PTY output (including ANSI SGR colour codes) to a safe HTML
 * string suitable for `dangerouslySetInnerHTML`.
 *
 * Moved from agent/ansiToHtml.ts during plugin restructuring (Phase 1).
 * This is a pure UI rendering utility — it lives in the UI layer.
 *
 * Supported SGR codes:
 *   0         — reset all attributes
 *   1/2/3/4   — bold, dim, italic, underline
 *   22/23/24  — turn off bold+dim, italic, underline
 *   30–37     — standard foreground colours (0–7)
 *   40–47     — standard background colours (0–7)
 *   90–97     — bright foreground colours   (8–15)
 *   100–107   — bright background colours   (8–15)
 *   38;5;n    — 256-colour foreground
 *   48;5;n    — 256-colour background
 *   38;2;r;g;b — true-colour foreground
 *   48;2;r;g;b — true-colour background
 *   39 / 49   — default foreground / background
 *
 * Non-SGR CSI sequences (cursor movement, screen-clear, etc.) and OSC/two-char
 * Fe sequences are silently discarded.
 *
 * Security: all literal text is HTML-escaped before output.  Only
 * `<span style="…">` tags are ever emitted, with style attribute values
 * derived exclusively from the parsed numeric codes — never from raw input.
 */

// ── xterm 16-colour palette ───────────────────────────────────────────────────
// Standard (indices 0–7) + Bright (indices 8–15).
// Palette values follow the xterm defaults used by most terminal emulators.
const ANSI_16: readonly string[] = [
  '#000000', '#cc0000', '#4e9a06', '#c4a000',   // 0 black, 1 red, 2 green, 3 yellow
  '#3465a4', '#75507b', '#06989a', '#d3d7cf',   // 4 blue,  5 magenta, 6 cyan, 7 white
  '#555753', '#ef2929', '#8ae234', '#fce94f',   // 8–11 bright
  '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',   // 12–15 bright
] as const;

// ── 256-colour lookup ─────────────────────────────────────────────────────────

function get256Color(n: number): string {
  if (n < 16)  return ANSI_16[n];
  if (n >= 232) {
    // Greyscale ramp 232–255: 24 steps from rgb(8,8,8) to rgb(238,238,238).
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  // 6×6×6 colour cube 16–231.
  const idx = n - 16;
  const b   = idx % 6;
  const g   = Math.floor(idx / 6) % 6;
  const r   = Math.floor(idx / 36);
  const toV = (c: number): number => (c === 0 ? 0 : 55 + c * 40);
  return `rgb(${toV(r)},${toV(g)},${toV(b)})`;
}

// ── SGR attribute state ───────────────────────────────────────────────────────

interface SgrState {
  /** CSS colour string for the foreground, or `null` for the terminal default. */
  fg: string | null;
  /** CSS colour string for the background, or `null` for the terminal default. */
  bg: string | null;
  bold:      boolean;
  dim:       boolean;
  italic:    boolean;
  underline: boolean;
}

function defaultSgrState(): SgrState {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
}

function sgrStateToStyle(s: SgrState): string {
  const parts: string[] = [];
  if (s.fg)        parts.push(`color:${s.fg}`);
  if (s.bg)        parts.push(`background:${s.bg}`);
  if (s.bold)      parts.push('font-weight:700');
  if (s.dim)       parts.push('opacity:0.6');
  if (s.italic)    parts.push('font-style:italic');
  if (s.underline) parts.push('text-decoration:underline');
  return parts.join(';');
}

function applySgrCodes(state: SgrState, codes: readonly number[]): SgrState {
  let s = { ...state };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    /* eslint-disable no-multi-spaces */
    if      (c === 0)                                                        { s = defaultSgrState(); }
    else if (c === 1)                                                          s.bold      = true;
    else if (c === 2)                                                          s.dim       = true;
    else if (c === 3)                                                          s.italic    = true;
    else if (c === 4)                                                          s.underline = true;
    else if (c === 22)                                                       { s.bold = false; s.dim = false; }
    else if (c === 23)                                                         s.italic    = false;
    else if (c === 24)                                                         s.underline = false;
    else if (c === 39)                                                         s.fg = null;
    else if (c === 49)                                                         s.bg = null;
    else if (c >= 30  && c <= 37)                                              s.fg = ANSI_16[c - 30];
    else if (c >= 40  && c <= 47)                                              s.bg = ANSI_16[c - 40];
    else if (c >= 90  && c <= 97)                                              s.fg = ANSI_16[(c - 90)  + 8];
    else if (c >= 100 && c <= 107)                                             s.bg = ANSI_16[(c - 100) + 8];
    else if (c === 38 && codes[i + 1] === 5 && i + 2 < codes.length)        { s.fg = get256Color(codes[i + 2]); i += 2; }
    else if (c === 48 && codes[i + 1] === 5 && i + 2 < codes.length)        { s.bg = get256Color(codes[i + 2]); i += 2; }
    else if (c === 38 && codes[i + 1] === 2 && i + 4 < codes.length)        { s.fg = `rgb(${codes[i+2]},${codes[i+3]},${codes[i+4]})`; i += 4; }
    else if (c === 48 && codes[i + 1] === 2 && i + 4 < codes.length)        { s.bg = `rgb(${codes[i+2]},${codes[i+3]},${codes[i+4]})`; i += 4; }
    /* eslint-enable no-multi-spaces */
  }
  return s;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderText(text: string, state: SgrState): string {
  const style   = sgrStateToStyle(state);
  const escaped = escapeHtml(text);
  return style ? `<span style="${style}">${escaped}</span>` : escaped;
}

// ── ANSI sequence regex ───────────────────────────────────────────────────────
//
// Matches three classes of ANSI/VT escape sequence (all start with ESC = \x1b):
//
//   CSI  ESC [ <param bytes 0x30–0x3F>* <inter bytes 0x20–0x2F>* <final 0x40–0x7E>
//        Groups: (1) '[', (2) param string, (3) final byte
//        e.g. ESC[32m  →  green fg,  ESC[0m  →  reset
//
//   OSC  ESC ] <text> BEL | ST
//        Group (4): the OSC text (discarded)
//        e.g. ESC]0;window title BEL
//
//   Two-char Fe  ESC <0x40–0x5F> (excluding '[' 0x5B and ']' 0x5D)
//        e.g. ESC M (reverse index), ESC = (alternate keypad)
//
// ORDER IS CRITICAL: the OSC alternative must precede the two-char catchall
// because ']' (0x5D) falls in the [@-Z\-_] character class; placing OSC last
// would silently consume the ESC] introducer as a two-char sequence and let the
// title text leak into the rendered output.
//
// Character class breakdown for "[@-Z\\-_]":
//   [@-Z]  →  0x40–0x5A  (excludes 0x5B '[' and 0x5D ']' which are CSI/OSC)
//   [\\-_] →  0x5C–0x5F  (backslash, right-bracket is NOT included here)
const ANSI_RE =
  /\x1b(?:(\[)([0-9;:]*)([ -~])|\]([^\x07\x1b]*)(?:\x07|\x1b\\)|[@-Z\\-_])/g;

// ── Raw chunk accumulator ─────────────────────────────────────────────────────

/**
 * Append a new raw PTY chunk to the accumulated output buffer, applying
 * carriage-return overwrite semantics so that progress-bar overwrites are
 * handled correctly.
 *
 * The returned string still contains ANSI escape sequences — pass it to
 * {@link ansiToHtml} at render time.
 *
 * @example
 * ```ts
 * const [rawOutput, setRawOutput] = useState('');
 * // In the SSE stream handler:
 * setRawOutput(prev => applyRawChunk(prev, chunk));
 * ```
 */
export function applyRawChunk(prev: string, raw: string): string {
  return processCarriageReturns(prev + raw);
}

// ── processCarriageReturns dependency ─────────────────────────────────────────

/**
 * Simulate bare `\r` (carriage return without following `\n`) overwrite
 * semantics on the raw terminal string.
 *
 * A bare `\r` moves the cursor to column 0 of the current line, allowing the
 * next write to overwrite it.
 */
function processCarriageReturns(raw: string): string {
  const s = raw.replace(/\r\n/g, '\n');
  if (!s.includes('\r')) return s;

  const parts = s.split('\r');
  let result  = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const lastNl = result.lastIndexOf('\n');
    result = result.slice(0, lastNl + 1) + parts[i];
  }
  return result;
}

// ── ANSI → HTML ───────────────────────────────────────────────────────────────

/**
 * Convert a raw PTY output string (ANSI escape sequences included) to an HTML
 * string safe for `dangerouslySetInnerHTML`.
 *
 * All literal text is HTML-escaped; only `<span style="…">` tags are emitted,
 * with style values derived exclusively from the parsed numeric SGR codes.
 *
 * @example
 * ```tsx
 * const html = useMemo(() => ansiToHtml(rawOutput), [rawOutput]);
 * <pre dangerouslySetInnerHTML={{ __html: html }} />
 * ```
 */
export function ansiToHtml(raw: string): string {
  let state     = defaultSgrState();
  let html      = '';
  let lastIndex = 0;

  ANSI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ANSI_RE.exec(raw)) !== null) {
    // Flush plain text that precedes this escape sequence.
    const text = raw.slice(lastIndex, match.index);
    if (text) html += renderText(text, state);
    lastIndex = match.index + match[0].length;

    // Only CSI sequences with final byte 'm' (SGR) affect rendering state.
    // All other sequences (cursor movement, screen-clear, OSC titles, etc.)
    // are silently discarded.
    const isCsi = match[1] === '[';
    if (isCsi && match[3] === 'm') {
      const params = match[2];
      const codes: number[] = params
        ? params.split(';').map(p => parseInt(p || '0', 10))
        : [0];
      state = applySgrCodes(state, codes);
    }
  }

  // Flush any remaining text after the last escape sequence.
  const remaining = raw.slice(lastIndex);
  if (remaining) html += renderText(remaining, state);

  return html;
}
