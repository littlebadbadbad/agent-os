import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTerminalTools } from '../../tools/terminal/tools';
import { createHttpTerminalAdapter } from '../../tools/terminal/adapter';
import type { TerminalManagerAdapter, TerminalEntry } from '../../tools/terminal';

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

  it('returns reason="exited" when the terminal exits on the first poll', async () => {
    const adapter = makeAdapter({
      readOutput: vi.fn().mockResolvedValue({
        output: 'done', offset: 4, running: false, exitCode: 0,
      }),
    });
    const { wait } = getTools(adapter);

    const result = await wait.execute({ id: 'term_1', idleMs: 100, timeoutMs: 5000 }, ctx) as any;

    expect(result.reason).toBe('exited');
    expect(result.timedOut).toBe(false);
    expect(result.running).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('returns reason="idle" when no output arrives for idleMs', async () => {
    const adapter = makeAdapter({
      // Always running, never any new output.
      readOutput: vi.fn().mockResolvedValue({ output: '', offset: 0, running: true }),
    });
    const { wait } = getTools(adapter);

    // idleMs=100 �?poll every 50 ms; should return idle after ~100 ms.
    const result = await wait.execute({ id: 'term_1', idleMs: 100, timeoutMs: 5000 }, ctx) as any;

    expect(result.reason).toBe('idle');
    expect(result.timedOut).toBe(false);
  }, 3000);

  it('returns reason="idle" only after output stops flowing', async () => {
    let callN = 0;
    const adapter = makeAdapter({
      // First 3 calls return chunks; subsequent calls return nothing.
      readOutput: vi.fn().mockImplementation(async () => {
        callN++;
        if (callN <= 3) return { output: `chunk${callN}`, offset: callN * 6, running: true };
        return { output: '', offset: 18, running: true };
      }),
    });
    const { wait } = getTools(adapter);

    const result = await wait.execute({ id: 'term_1', idleMs: 100, timeoutMs: 5000 }, ctx) as any;

    expect(result.reason).toBe('idle');
    // Must have polled at least 4 times (3 with output + �? silent + final snapshot).
    expect(callN).toBeGreaterThanOrEqual(4);
  }, 3000);

  it('returns timedOut=true and reason="timeout" when deadline expires', async () => {
    const adapter = makeAdapter({
      readOutput: vi.fn().mockResolvedValue({ output: '', offset: 0, running: true }),
    });
    const { wait } = getTools(adapter);

    // idleMs=10000 ensures idle never fires; timeout fires after 200ms.
    // pollMs = min(5000, 250) = 250ms �?first sleep overshoots deadline.
    const result = await wait.execute({ id: 'term_1', idleMs: 10000, timeoutMs: 200 }, ctx) as any;

    expect(result.timedOut).toBe(true);
    expect(result.reason).toBe('timeout');
    // Ctrl+C must have been sent when timing out.
    expect(adapter.sendInput).toHaveBeenCalledWith('term_1', '\x03', SESSION);
  }, 3000);

  it('returns reason="aborted" immediately when signal is pre-aborted', async () => {
    const adapter = makeAdapter();
    const { wait } = getTools(adapter);

    const ctrl = new AbortController();
    ctrl.abort();

    const result = await wait.execute(
      { id: 'term_1', idleMs: 100, timeoutMs: 5000 },
      { ...ctx, signal: ctrl.signal },
    ) as any;

    expect(result.reason).toBe('aborted');
    expect(result.timedOut).toBe(false);
    // readOutput may have been called at most once (for the final snapshot).
    expect(vi.mocked(adapter.readOutput).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('advances the shared read cursor so terminal_read continues from the right offset', async () => {
    // terminal_wait (exited path) makes 2 readOutput calls: poll + full snapshot.
    // terminal_read then makes a 3rd call �?it must pass the cursor advanced by terminal_wait.
    const adapter = makeAdapter({
      readOutput: vi.fn()
        .mockResolvedValueOnce({ output: 'output', offset: 42, running: false, exitCode: 0 })
        .mockResolvedValueOnce({ output: 'output', offset: 42, running: false, exitCode: 0 })
        .mockResolvedValueOnce({ output: '',       offset: 42, running: false, exitCode: 0 }),
    });
    const { wait, read } = getTools(adapter);

    await wait.execute({ id: 'term_1' }, ctx);
    await read.execute({ id: 'term_1' }, ctx);

    // The third readOutput call (from terminal_read) must pass offset=42.
    const readOffset = vi.mocked(adapter.readOutput).mock.calls[2][1];
    expect(readOffset).toBe(42);
  });
});

// ── resizePty (HTTP adapter) ───────────────────────────────────────────────────

describe('createHttpTerminalAdapter �?resizePty', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('POSTs to /terminals/:id/resize with cols and rows', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const adapter = createHttpTerminalAdapter({ baseUrl: '/api' });
    await adapter.resizePty('term_abc', 120, 30, 'sess-1');

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/terminals/term_abc/resize');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ cols: 120, rows: 30 });
  });

  it('URL-encodes special characters in terminal id', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const adapter = createHttpTerminalAdapter({ baseUrl: '/api' });
    await adapter.resizePty('term a/b', 80, 24, 'sess-1');

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain(encodeURIComponent('term a/b'));
  });

  it('throws when the server responds with a non-OK status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => ({ error: 'Terminal "x" not found' }),
    } as Response);

    const adapter = createHttpTerminalAdapter({ baseUrl: '/api' });
    await expect(adapter.resizePty('x', 80, 24, 'sess-1')).rejects.toThrow(/not found/i);
  });
});

// ── terminal_sleep ────────────────────────────────────────────────────────────

describe('terminal_sleep', () => {
  it('exists in the tool set returned by createTerminalTools', () => {
    const { tools } = createTerminalTools(makeAdapter());
    expect(tools.some(t => t.name === 'terminal_sleep')).toBe(true);
  });

  it('returns slept≈durationMs and aborted=false on a normal sleep', async () => {
    const { tools } = createTerminalTools(makeAdapter());
    const sleep = tools.find(t => t.name === 'terminal_sleep')!;

    const before = Date.now();
    const result = await sleep.execute({ durationMs: 50 }, ctx) as { slept: number; aborted: boolean };

    expect(result.aborted).toBe(false);
    expect(result.slept).toBeGreaterThanOrEqual(40); // allow some timer jitter
    expect(Date.now() - before).toBeGreaterThanOrEqual(40);
  }, 2000);

  it('returns early with aborted=true when signal fires before durationMs elapses', async () => {
    const { tools } = createTerminalTools(makeAdapter());
    const sleep = tools.find(t => t.name === 'terminal_sleep')!;
    const ctrl  = new AbortController();

    const promise = sleep.execute({ durationMs: 5_000 }, { ...ctx, signal: ctrl.signal }) as Promise<{ slept: number; aborted: boolean }>;
    // Abort almost immediately.
    setTimeout(() => ctrl.abort(), 30);

    const result = await promise;
    expect(result.aborted).toBe(true);
    // Should have returned well before the 5 second duration.
    expect(result.slept).toBeLessThan(1_000);
  }, 3000);
});

// ── terminal_wait �?user cancel ───────────────────────────────────────────────

describe('terminal_wait �?user cancel via requestUserInput', () => {
  it('returns reason="cancelled" when the user responds to the cancel prompt', async () => {
    const adapter = makeAdapter({
      // Terminal stays running indefinitely.
      readOutput: vi.fn().mockResolvedValue({ output: '', offset: 0, running: true }),
    });
    const { wait } = getTools(adapter);

    // Simulate the user clicking OK on the cancel prompt after a short delay.
    let resolveInput!: (v: string | null) => void;
    const cancelCtx = {
      ...ctx,
      requestUserInput: () => new Promise<string | null>((r) => { resolveInput = r; }),
    };

    const waitPromise = wait.execute({ id: 'term_1', idleMs: 10_000, timeoutMs: 60_000 }, cancelCtx);

    // Let the poll loop run at least one tick, then trigger user cancel.
    await new Promise<void>(r => setTimeout(r, 80));
    resolveInput('yes');

    const result = await waitPromise as any;
    expect(result.reason).toBe('cancelled');
    expect(result.timedOut).toBe(false);
  }, 5000);

  it('issues an ephemeral requestUserInput so the prompt is never persisted', async () => {
    const adapter = makeAdapter({
      readOutput: vi.fn().mockResolvedValue({ output: 'done', offset: 4, running: false, exitCode: 0 }),
    });
    const { wait } = getTools(adapter);

    const capturedRequests: any[] = [];
    const capturingCtx = {
      ...ctx,
      requestUserInput: (req: any) => { capturedRequests.push(req); return Promise.resolve(null); },
    };

    await wait.execute({ id: 'term_1' }, capturingCtx);

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].ephemeral).toBe(true);
    expect(capturedRequests[0].type).toBe('confirm');
  });
});

