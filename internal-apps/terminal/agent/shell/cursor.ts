/**
 * Per-session per-terminal read cursor tracking.
 *
 * The cursor tracks the byte offset for incremental reads so the agent
 * never re-reads output it has already seen.  Key format: `${sessionId}:${terminalId}`.
 */

export interface ReadCursor {
  getOffset(sessionId: string, terminalId: string): number;
  advance(sessionId: string, terminalId: string, offset: number): void;
}

export function createReadCursor(): ReadCursor {
  const cursors = new Map<string, number>();

  return {
    getOffset(sessionId: string, terminalId: string): number {
      return cursors.get(`${sessionId}:${terminalId}`) ?? 0;
    },

    advance(sessionId: string, terminalId: string, offset: number): void {
      cursors.set(`${sessionId}:${terminalId}`, offset);
    },
  };
}
