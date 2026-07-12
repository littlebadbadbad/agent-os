/**
 * extensions/terminal/agent/processCarriageReturns.ts — Carriage-return processing
 *
 * Extracted from agent/ansiToHtml.ts during plugin restructuring (Phase 1).
 * This function handles raw PTY output with bare \r overwrite semantics,
 * and is used by the agent layer to process terminal output before sending
 * to the LLM (no HTML rendering involved).
 */

/**
 * Simulate bare `\r` (carriage return without following `\n`) overwrite
 * semantics on the raw terminal string.
 *
 * A bare `\r` moves the cursor to column 0 of the current line, allowing the
 * next write to overwrite it.  This is the mechanism used by progress bars,
 * spinners, and build-tool output to update a single line in place.
 *
 * The function operates on the **raw** string (ANSI codes still present) so
 * that colour state introduced by the overwriting text is preserved.
 */
export function processCarriageReturns(raw: string): string {
  const s = raw.replace(/\r\n/g, '\n');   // normalise Windows CRLF → LF first
  if (!s.includes('\r')) return s;

  const parts = s.split('\r');
  let result  = parts[0];
  for (let i = 1; i < parts.length; i++) {
    // Find the start of the current (last) line so we overwrite from there.
    const lastNl = result.lastIndexOf('\n');
    result = result.slice(0, lastNl + 1) + parts[i];
  }
  return result;
}
