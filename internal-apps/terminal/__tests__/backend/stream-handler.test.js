/**
 * extensions/terminal/__tests__/backend/stream-handler.test.js
 *
 * Behavioral test for the backend stream handler.
 *
 * The key fix: `readTerminalOutput` is now called INSIDE `subscribe()`
 * (not in the defineStream handler), so the initial state read and the
 * live subscription happen sequentially in single-threaded JS with no
 * gap where data could be lost.
 *
 * This test creates a mock BackendAppHost, activates the terminal
 * app, and verifies the stream handler's subscribe() behavior:
 *   - Reads initial state at subscribe time
 *   - Replays history before subscribing to live output
 *   - Handles already-exited terminals
 *   - Forwards live output chunks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockReadTerminalOutput = vi.fn();
const mockSubscribeTerminalOutput = vi.fn();
const mockKillAllTerminals = vi.fn();

vi.mock('../../backend/services/terminals.js', () => ({
  readTerminalOutput: (...args) => mockReadTerminalOutput(...args),
  subscribeTerminalOutput: (...args) => mockSubscribeTerminalOutput(...args),
  killAllTerminals: (...args) => mockKillAllTerminals(...args),
  listTerminals: vi.fn().mockReturnValue({ terminals: [] }),
  availableShells: vi.fn().mockReturnValue([]),
  createTerminalSession: vi.fn(),
  removeTerminalSession: vi.fn(),
  sendTerminalInput: vi.fn(),
  getTerminalSession: vi.fn(),
  resizeTerminalSession: vi.fn(),
  sleepTerminal: vi.fn(),
  waitTerminal: vi.fn(),
}));

// Import SUT AFTER mocks (vitest hoists vi.mock but keeps import order)
import { activate } from '../../backend/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockHost() {
  const apiHandlers = new Map();
  const streamHandlers = new Map();
  const registeredServices = new Map();

  return {
    defineApi: (method, handler) => {
      apiHandlers.set(method, handler);
    },
    defineStream: (name, handler) => {
      streamHandlers.set(name, handler);
    },
    getStreamHandler: (name) => streamHandlers.get(name),
    getApiHandler: (method) => apiHandlers.get(method),
    getConfig: vi.fn(),
    services: {
      register: (name, service) => {
        registeredServices.set(name, service);
        return () => registeredServices.delete(name);
      },
      resolve: (name) => registeredServices.get(name),
    },
  };
}

function createMockIo() {
  const sent = [];
  let closed = false;

  return {
    sendJSON: (obj) => {
      sent.push(obj);
    },
    close: () => {
      closed = true;
    },
    isConnected: () => true,
    sent,
    get closed() { return closed; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Terminal backend stream handler', () => {
  let host;

  beforeEach(() => {
    // Reset call history but KEEP mock implementations/return values
    mockReadTerminalOutput.mockClear();
    mockSubscribeTerminalOutput.mockClear();

    // Default: readTerminalOutput returns a valid running terminal
    mockReadTerminalOutput.mockReturnValue({
      output: '',
      offset: 0,
      running: true,
      exitCode: undefined,
    });

    host = createMockHost();

    // Activate the app to register the stream handler
    activate(host);
  });

  it('reads initial state at subscribe time (not at connect time)', () => {
    const handler = host.getStreamHandler('stream');
    expect(handler).toBeDefined();

    mockReadTerminalOutput.mockReturnValue({
      output: 'initial history',
      offset: 16,
      running: false,
      exitCode: 0,
    });

    const io = createMockIo();
    const conn = handler({ id: 'term_1' }, io);

    // Before subscribe(), readTerminalOutput should NOT have been called yet
    expect(mockReadTerminalOutput).not.toHaveBeenCalled();

    // Subscribe triggers the read
    conn.subscribe();

    expect(mockReadTerminalOutput).toHaveBeenCalledWith({ id: 'term_1', fromOffset: 0 });
  });

  it('replays history before subscribing to live output on running terminals', () => {
    const handler = host.getStreamHandler('stream');

    mockReadTerminalOutput.mockReturnValue({
      output: 'buffered\nhistory\n',
      offset: 18,
      running: true,
      exitCode: undefined,
    });

    const io = createMockIo();
    const conn = handler({ id: 'term_live' }, io);
    conn.subscribe();

    // History should be sent before live subscription
    expect(io.sent.length).toBeGreaterThanOrEqual(1);
    expect(io.sent[0]).toEqual({ output: 'buffered\nhistory\n' });

    // Live subscription should have been started
    expect(mockSubscribeTerminalOutput).toHaveBeenCalledWith({
      id: 'term_live',
      signal: expect.any(AbortSignal),
      onOutput: expect.any(Function),
      onDone: expect.any(Function),
    });
  });

  it('for already-exited terminals: sends done immediately and does NOT subscribe to live output', () => {
    const handler = host.getStreamHandler('stream');

    mockReadTerminalOutput.mockReturnValue({
      output: 'final output',
      offset: 12,
      running: false,
      exitCode: 0,
    });

    const io = createMockIo();
    const conn = handler({ id: 'term_dead' }, io);
    conn.subscribe();

    // History should be replayed
    expect(io.sent[0]).toEqual({ output: 'final output' });

    // Done signal should be sent
    expect(io.sent[1]).toEqual({ type: 'done', exitCode: 0 });

    // io.close() should have been called
    expect(io.closed).toBe(true);

    // No live subscription
    expect(mockSubscribeTerminalOutput).not.toHaveBeenCalled();
  });

  it('forwards live output chunks from subscribeTerminalOutput onOutput callback', () => {
    const handler = host.getStreamHandler('stream');

    mockReadTerminalOutput.mockReturnValue({
      output: '',
      offset: 0,
      running: true,
    });

    // Capture the onOutput callback
    let capturedOnOutput;
    mockSubscribeTerminalOutput.mockImplementation(({ onOutput }) => {
      capturedOnOutput = onOutput;
    });

    const io = createMockIo();
    const conn = handler({ id: 'term_live' }, io);
    conn.subscribe();

    // Simulate live output from PTY
    capturedOnOutput('live chunk 1');
    capturedOnOutput('live chunk 2');

    // Empty history is skipped by the backend (history.length === 0 check)
    expect(io.sent).toEqual([
      { output: 'live chunk 1' },     // live data
      { output: 'live chunk 2' },     // live data
    ]);
  });

  it('forwards done signal from subscribeTerminalOutput onDone callback', () => {
    const handler = host.getStreamHandler('stream');

    mockReadTerminalOutput.mockReturnValue({
      output: '',
      offset: 0,
      running: true,
    });

    let capturedOnDone;
    mockSubscribeTerminalOutput.mockImplementation(({ onDone }) => {
      capturedOnDone = onDone;
    });

    const io = createMockIo();
    const conn = handler({ id: 'term_live' }, io);
    conn.subscribe();

    capturedOnDone(0);

    // Should close IO
    expect(io.closed).toBe(true);

    // Last message should be done
    const lastMsg = io.sent[io.sent.length - 1];
    expect(lastMsg).toEqual({ type: 'done', exitCode: 0 });
  });

  it('returns unsubscribe that aborts the subscription controller', () => {
    const handler = host.getStreamHandler('stream');

    mockReadTerminalOutput.mockReturnValue({
      output: '',
      offset: 0,
      running: true,
    });

    let capturedSignal;
    mockSubscribeTerminalOutput.mockImplementation(({ signal }) => {
      capturedSignal = signal;
    });

    const io = createMockIo();
    const conn = handler({ id: 'term_live' }, io);
    const { unsubscribe } = conn.subscribe();

    expect(capturedSignal.aborted).toBe(false);
    unsubscribe();
    expect(capturedSignal.aborted).toBe(true);
  });

  it('throws when terminal id is missing', () => {
    const handler = host.getStreamHandler('stream');

    expect(() => {
      handler({}, createMockIo());
    }).toThrow('stream: id is required');
  });

  it('throws when terminal is not found at subscribe time', () => {
    const handler = host.getStreamHandler('stream');

    mockReadTerminalOutput.mockImplementation(() => {
      throw new Error('Terminal "ghost" not found');
    });

    const io = createMockIo();
    const conn = handler({ id: 'ghost' }, io);

    expect(() => {
      conn.subscribe();
    }).toThrow('Terminal "ghost" not found');
  });
});
