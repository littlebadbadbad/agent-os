/**
 * extensions/terminal/agent/upgrade/truncateOutput.ts — Output truncation
 *
 * Head+tail truncation for long build/test output.
 * The generic ToolResult clamp cuts from the end — worst place for compiler
 * output (failure stacks live at the tail). This preserves both ends.
 */

const DEFAULT_MAX = 32_000;
const DEFAULT_HEAD = 8_000;

export function truncateHeadTail(
  text: string,
  opts: { max?: number; head?: number } = {},
): string {
  const max = opts.max ?? DEFAULT_MAX;
  if (text.length <= max) return text;

  const head = Math.min(opts.head ?? DEFAULT_HEAD, Math.floor(max / 3));
  const tail = max - head;
  const omitted = text.length - head - tail;

  return (
    text.slice(0, head) +
    `\n\n[… ${omitted.toLocaleString()} chars omitted from middle …]\n\n` +
    text.slice(-tail)
  );
}
