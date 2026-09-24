/**
 * Tests for agent-UI/app/apiClient.ts — IPC connectStream lifecycle
 *
 * These tests specifically target the IPC stream lifecycle fix:
 *   - doInvoke(':connect') is now called INSIDE subscribe() so that IPC
 *     listeners are registered BEFORE the connect RPC is sent
 *   - cancelled flag prevents stale connect results from creating connections
 *   - unsubscribe tears down IPC listeners synchronously, then disconnects
 *   - Duplicate subscribe() calls are rejected
 *
 * The mock uses options.invoke and options.on (DI pattern) instead of
 * stubbing window.electronAPI, so these tests are self-contained.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Enable IPC mode so createIpcAppApiClient is used
vi.mock('../env', () => ({ IS_ELECTRON_IPC: true, IS_DEBUG: false }));

describe('IPC connectStream — lifecycle', () => {
  const mockInvoke = vi.fn<[string, Record<string, unknown>], Promise<unknown>>();
  const mockOn = vi.fn<[string, (...args: unknown[]) => void], () => void>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers IPC listeners on :data and :end BEFORE calling doInvoke(:connect)', async () => {
    // Track call order
    const callOrder: string[] = [];

    mockOn.mockImplementation((_channel, _cb) => {
      callOrder.push(`on:${_channel}`);
      return vi.fn();
    });

    let resolveConnect!: (v: unknown) => void;
    mockInvoke.mockImplementation((_channel) => {
      callOrder.push(`invoke:${_channel}`);
      return new Promise((r) => { resolveConnect = r; });
    });

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('myStream', { id: 'term_1' });
    stream.subscribe();

    // The subscribe() should register listeners BEFORE calling connect
    expect(callOrder).toEqual([
      'on:app:test:myStream:data',
      'on:app:test:myStream:frame',
      'on:app:test:myStream:end',
      'invoke:app:test:myStream:connect',
    ]);

    resolveConnect!({ connectionId: 'c1' });
  });

  it('delivers data pushed through the :data channel to onData', async () => {
    // Capture the actual :data listener
    let dataListener!: (...args: unknown[]) => void;
    mockOn.mockImplementation((channel, cb) => {
      if (channel.endsWith(':data')) dataListener = cb;
      return vi.fn();
    });
    mockInvoke.mockResolvedValue({ connectionId: 'c1' });

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('s', {});
    const onDataSpy = vi.fn();
    stream.callbacks.onData = onDataSpy;
    stream.subscribe();

    // Simulate backend pushing data via IPC
    dataListener({ output: 'hello' });

    expect(onDataSpy).toHaveBeenCalledWith({ output: 'hello' });
  });

  it('delivers end signal through the :end channel to onEnd', async () => {
    let endListener!: (...args: unknown[]) => void;
    mockOn.mockImplementation((channel, cb) => {
      if (channel.endsWith(':end')) endListener = cb;
      return vi.fn();
    });
    mockInvoke.mockResolvedValue({ connectionId: 'c1' });

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('s', {});
    const onEndSpy = vi.fn();
    stream.callbacks.onEnd = onEndSpy;
    stream.subscribe();

    endListener();

    expect(onEndSpy).toHaveBeenCalledOnce();
  });

  it('unsubscribe removes IPC listeners and sends disconnect after connect resolves', async () => {
    let resolveConnect!: (v: unknown) => void;
    const unsubData = vi.fn();
    const unsubEnd = vi.fn();

    // Return different cleanup functions per channel so we can track them
    mockOn.mockImplementation((channel) => {
      if (channel.endsWith(':data')) return unsubData;
      if (channel.endsWith(':end')) return unsubEnd;
      return vi.fn();
    });

    mockInvoke.mockImplementation((channel) => {
      if (channel.endsWith(':connect')) {
        return new Promise((r) => { resolveConnect = r; });
      }
      if (channel.endsWith(':disconnect')) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({});
    });

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('s', {});
    const { unsubscribe } = stream.subscribe();

    // Connect hasn't resolved yet — no disconnect should be sent
    expect(mockInvoke).not.toHaveBeenCalledWith(expect.stringContaining(':disconnect'), expect.anything());

    // Now resolve connect
    resolveConnect!({ connectionId: 'c1' });
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('app:test:s:connect', {});
    });

    // Unsubscribe
    unsubscribe();

    // IPC listeners should be removed FIRST
    expect(unsubData).toHaveBeenCalledOnce();
    expect(unsubEnd).toHaveBeenCalledOnce();

    // Then disconnect should be sent
    expect(mockInvoke).toHaveBeenCalledWith('app:test:s:disconnect', { connectionId: 'c1' });
  });

  it('rejects duplicate subscribe calls with a no-op unsubscribe', async () => {
    mockOn.mockReturnValue(vi.fn());
    mockInvoke.mockResolvedValue({ connectionId: 'c1' });

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('s', {});

    // First subscribe
    const sub1 = stream.subscribe();
    // Second subscribe
    const sub2 = stream.subscribe();

    // Only one connect call should have been made
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('app:test:s:connect', {});

    // The second subscription's unsubscribe should be safe to call
    expect(() => sub2.unsubscribe()).not.toThrow();
  });

  it('cancelled flag prevents stale connect from setting connId — sends disconnect instead', async () => {
    let resolveConnect!: (v: unknown) => void;
    mockOn.mockReturnValue(vi.fn());
    mockInvoke.mockImplementation((channel) => {
      if (channel.endsWith(':connect')) {
        return new Promise((r) => { resolveConnect = r; });
      }
      return Promise.resolve({ ok: true });
    });

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('s', {});

    // Subscribe then immediately unsubscribe (simulating StrictMode double-mount)
    const { unsubscribe } = stream.subscribe();
    unsubscribe();

    // Now the connect RPC resolves — should send disconnect, NOT set connId
    resolveConnect!({ connectionId: 'c2' });
    await vi.waitFor(() => {
      // disconnect should have been called with c2
      const disconnectCalls = mockInvoke.mock.calls.filter(
        ([ch]) => (ch as string).endsWith(':disconnect'),
      );
      expect(disconnectCalls.length).toBe(1);
      expect(disconnectCalls[0][1]).toEqual({ connectionId: 'c2' });
    });
  });

  it('calls onError when connect fails and not cancelled', async () => {
    mockOn.mockReturnValue(vi.fn());
    mockInvoke.mockImplementation((channel) => {
      if (channel.endsWith(':connect')) {
        return Promise.reject(new Error('Connection refused'));
      }
      return Promise.resolve({});
    });

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('s', {});
    const onErrorSpy = vi.fn();
    stream.callbacks.onError = onErrorSpy;
    stream.subscribe();

    await vi.waitFor(() => {
      expect(onErrorSpy).toHaveBeenCalledOnce();
    });
    expect(onErrorSpy).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Connection refused',
    }));
  });

  it('suppresses onError when cancelled before connect fails', async () => {
    mockOn.mockReturnValue(vi.fn());
    let rejectConnect!: (err: Error) => void;
    mockInvoke.mockImplementation((channel) => {
      if (channel.endsWith(':connect')) {
        return new Promise((_, r) => { rejectConnect = r; });
      }
      return Promise.resolve({});
    });

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('s', {});
    const onErrorSpy = vi.fn();
    stream.callbacks.onError = onErrorSpy;
    stream.subscribe();

    // Cancel before connect fails
    stream.subscribe().unsubscribe();

    rejectConnect!(new Error('Connection refused'));

    // onError should NOT have been called because cancelled=true
    expect(onErrorSpy).not.toHaveBeenCalled();
  });

  it('connId is null when connect never resolves after unsubscribe', async () => {
    //  Never resolve the connect promise
    mockOn.mockReturnValue(vi.fn());
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('s', {});
    const { unsubscribe } = stream.subscribe();
    unsubscribe();

    // No disconnect should be sent because connId was never set
    const disconnectCalls = mockInvoke.mock.calls.filter(
      ([ch]) => (ch as string).endsWith(':disconnect'),
    );
    expect(disconnectCalls).toHaveLength(0);
  });

  it('passes params through to doInvoke(:connect)', async () => {
    mockOn.mockReturnValue(vi.fn());
    mockInvoke.mockResolvedValue({ connectionId: 'c1' });

    const { createAppApiClient } = await import('../app/apiClient');
    const client = createAppApiClient('test', {
      invoke: mockInvoke,
      on: mockOn,
    });

    const stream = client.connectStream('s', { foo: 'bar', num: 42 });
    stream.subscribe();

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('app:test:s:connect', { foo: 'bar', num: 42 });
    });
  });
});
