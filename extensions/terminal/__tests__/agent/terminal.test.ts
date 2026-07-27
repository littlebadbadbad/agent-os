import { describe, it, expect, vi } from 'vitest';
import { createTerminalTools, createTerminalPluginAdapter } from '../../agent/shell';
import type { TerminalManagerAdapter, TerminalEntry, WaitResult } from '../../agent/shell';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<TerminalEntry> = {}): TerminalEntry {
  return {
    id:          'term_1',
    label:       'test',
    shell:       'bash',
    shellFamily: 'bash',
    cwd:         null,
    running:     true,
    createdAt:   new Date().toISOString(),
    outputBytes: 0,
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<TerminalManagerAdapter> = {}): TerminalManagerAdapter {
  return {
    listTerminals:  vi.fn().mockResolvedValue([]),
    listShells:     vi.fn().mockResolvedValue([]),
    createTerminal: vi.fn(),
    removeTerminal: vi.fn().mockResolvedValue(undefined),
    sendInput:      vi.fn().mockResolvedValue(undefined),
    readOutput:     vi.fn().mockResolvedValue({ output: '', offset: 0, running: true }),
    streamOutput:   vi.fn().mockReturnValue(() => {}),
    resizePty:      vi.fn().mockResolvedValue(undefined),
    waitTerminal:   vi.fn().mockResolvedValue({
      output: '', offset: 0, running: false, exitCode: 0,
      timedOut: false, reason: 'exited',
    } satisfies WaitResult),
    cancelWait:     vi.fn().mockResolvedValue(undefined),
    sleepTerminal:  vi.fn().mockResolvedValue({ slept: 100, aborted: false }),
    ...overrides,
  };
}

function getTools(adapter: TerminalManagerAdapter) {
  const { tools } = createTerminalTools(adapter);
  return {
    wait:   tools.find(t => t.name === 'terminal_wait')!,
    read:   tools.find(t => t.name === 'terminal_read')!,
    send:   tools.find(t => t.name === 'terminal_send')!,
  };
}

const SESSION = 'session-test';
const ctx = {
  sessionId:      SESSION,
  agentName:      'main',
  conversationId: SESSION, sourceAgent: 'main', isSubAgent: false,
  signal:         new AbortController().signal,
  requestUserInput: () => Promise.resolve(null),
  cancelUserInput: () => {},
};

// ── terminal_wait ─────────────────────────────────────────────────────────────

describe('terminal_wait', () => {
  it('exists in the tool set returned by createTerminalTools', () => {
    const adapter = makeAdapter();
    const { tools } = createTerminalTools(adapter);
    expect(tools.some(t => t.name === 'terminal_wait')).toBe(true);
  });

  it('delegates to adapter.waitTerminal and returns the result', async () => {
    const expected: WaitResult = {
      output: 'done', offset: 4, running: false, exitCode: 0,
      timedOut: false, reason: 'exited',
    };
    const adapter = makeAdapter({
      waitTerminal: vi.fn().mockResolvedValue(expected),
    });
    const { wait } = getTools(adapter);

    const result = await wait.execute({ id: 'term_1', idleMs: 100, timeoutMs: 5000 }, ctx);

    expect(vi.mocked(adapter.waitTerminal)).toHaveBeenCalledWith(
      'term_1', { idleMs: 100, timeoutMs: 5000 }, SESSION,
    );
    expect(result).toEqual(expected);
  });

  it('advances the shared read cursor from waitTerminal result offset', async () => {
    const adapter = makeAdapter({
      waitTerminal: vi.fn().mockResolvedValue({
        output: 'output', offset: 42, running: false, exitCode: 0,
        timedOut: false, reason: 'exited',
      } satisfies WaitResult),
      readOutput: vi.fn().mockResolvedValue({ output: '', offset: 42, running: false }),
    });
    const { wait, read } = getTools(adapter);

    await wait.execute({ id: 'term_1' }, ctx);
    await read.execute({ id: 'term_1' }, ctx);

    // read should start from offset 42 (the cursor was advanced by wait)
    const readOffset = vi.mocked(adapter.readOutput).mock.calls[0][1];
    expect(readOffset).toBe(42);
  });

  it('returns reason="cancelled" and falls back to readOutput when waitTerminal throws', async () => {
    const adapter = makeAdapter({
      waitTerminal: vi.fn().mockRejectedValue(new Error('cancelled')),
      readOutput: vi.fn().mockResolvedValue({ output: 'partial', offset: 10, running: false, exitCode: 0 }),
    });
    const { wait } = getTools(adapter);

    const result = await wait.execute({ id: 'term_1', idleMs: 100, timeoutMs: 5000 }, ctx) as any;

    expect(result.reason).toBe('cancelled');
    expect(result.output).toBe('partial');
    expect(result.offset).toBe(10);
  });
});

// ── resizePty (plugin adapter) ────────────────────────────────────────────────

describe('createTerminalPluginAdapter — resizePty', () => {
  /**
   * Build a minimal PluginApiClient with a mocked call method.
   * Must use an object with a `.call()` method — passing a bare vi.fn()
   * would trigger Function.prototype.call and eat the first argument.
   */
  function mockApiClient() {
    const call = vi.fn().mockResolvedValue({ ok: true });
    return {
      call,
      connectStream: () => ({
        callbacks: { onData: () => {}, onEnd: () => {}, onError: () => {} },
        subscribe: () => ({ unsubscribe: () => {} }),
      }),
    };
  }

  it('calls the RPC endpoint with cols and rows', async () => {
    const apiClient = mockApiClient();
    const adapter = createTerminalPluginAdapter(apiClient);
    await adapter.resizePty('term_abc', 120, 30, 'sess-1');

    expect(apiClient.call).toHaveBeenCalledOnce();
    expect(apiClient.call).toHaveBeenCalledWith('resize', { id: 'term_abc', cols: 120, rows: 30 });
  });

  it('properly encodes special terminal ids', async () => {
    const apiClient = mockApiClient();
    const adapter = createTerminalPluginAdapter(apiClient);
    await adapter.resizePty('term a/b', 80, 24, 'sess-1');

    expect(apiClient.call).toHaveBeenCalledWith('resize', { id: 'term a/b', cols: 80, rows: 24 });
  });

  it('throws when the call rejects', async () => {
    const call = vi.fn().mockRejectedValue(new Error('Terminal "x" not found'));
    const adapter = createTerminalPluginAdapter({ call, connectStream: () => ({ callbacks: { onData: () => {}, onEnd: () => {}, onError: () => {} }, subscribe: () => ({ unsubscribe: () => {} }) }) });
    await expect(adapter.resizePty('x', 80, 24, 'sess-1')).rejects.toThrow(/not found/i);
  });
});

// ── terminal_sleep ────────────────────────────────────────────────────────────

describe('terminal_sleep', () => {
  it('exists in the tool set returned by createTerminalTools', () => {
    const { tools } = createTerminalTools(makeAdapter());
    expect(tools.some(t => t.name === 'terminal_sleep')).toBe(true);
  });

  it('delegates to adapter.sleepTerminal and returns the result', async () => {
    const adapter = makeAdapter({
      sleepTerminal: vi.fn().mockResolvedValue({ slept: 50, aborted: false }),
    });
    const { tools } = createTerminalTools(adapter);
    const sleep = tools.find(t => t.name === 'terminal_sleep')!;

    const result = await sleep.execute({ durationMs: 50 }, ctx) as { slept: number; aborted: boolean };

    expect(vi.mocked(adapter.sleepTerminal)).toHaveBeenCalledWith(50, ctx.sessionId);
    expect(result).toEqual({ slept: 50, aborted: false });
  });
});
