/**
 * Streaming text batcher.
 *
 * Streaming AI responses can emit hundreds of tiny text deltas per second.
 * Calling `setState` on every delta triggers a React re-render per character.
 * Instead we accumulate deltas in a local buffer and flush once per animation
 * frame (~60 fps), collapsing N state updates into one per 16 ms window.
 *
 * Works in both browser and non-browser environments (falls back to setTimeout).
 */

// ── Public type ───────────────────────────────────────────────────────────────

export type TextAppender = {
  /** Buffer `delta` for the next flush — returns immediately. */
  append(delta: string): void;
  /** Force-flush any buffered content synchronously (call on stream end). */
  flush(): void;
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a batched text appender that accumulates string deltas and flushes
 * them via `onFlush` at most once per animation frame.
 *
 * @param onFlush  Callback invoked with the accumulated text whenever the
 *                 batch is flushed.  The string is the concatenation of all
 *                 `append` calls since the last flush.
 */
export function makeBatchedAppender(onFlush: (text: string) => void): TextAppender {
  let buffer = '';
  let scheduled = false;

  function flush() {
    if (!buffer) return;
    const captured = buffer;
    buffer = '';
    scheduled = false;
    onFlush(captured);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, 0);
    }
  }

  return {
    append(delta: string) { buffer += delta; schedule(); },
    flush,
  };
}
