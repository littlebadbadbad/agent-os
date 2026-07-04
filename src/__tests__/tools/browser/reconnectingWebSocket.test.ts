import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReconnectingWebSocket } from '../../../utils/reconnectingWebSocket';

// ── Mock WebSocket ────────────────────────────────────────────────────────────

/** Proper constructor mock for WebSocket. */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onclose: ((ev: { wasClean: boolean; code: number; reason: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send = vi.fn();
  close = vi.fn((code?: number) => {
    this.readyState = 3;
    this.onclose?.({ wasClean: true, code: code ?? 1000, reason: '' });
  });

  constructor(_url: string) {
    instances.push(this);
  }

  _open(): void { this.readyState = 1; this.onopen?.(); }
  _close(wasClean = true, code = 1000): void { this.readyState = 3; this.onclose?.({ wasClean, code, reason: '' }); }
  _error(): void { this.onerror?.(new Event('error')); }
  _message(data: unknown): void { this.onmessage?.({ data }); }
}

let instances: MockWebSocket[] = [];

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  instances = [];
  (globalThis as any).WebSocket = MockWebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createReconnectingWebSocket', () => {
  it('opens a WebSocket connection on open()', () => {
    const rws = createReconnectingWebSocket('ws://localhost/test');
    rws.open();
    expect(instances).toHaveLength(1);
    expect(instances[0].binaryType).toBe('arraybuffer');
  });

  it('calls onOpen when the underlying WS connects', () => {
    const onOpen = vi.fn();
    const rws = createReconnectingWebSocket('ws://localhost/test', { onOpen });
    rws.open();
    instances[0]._open();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('calls onMessage when a message arrives', () => {
    const onMessage = vi.fn();
    const rws = createReconnectingWebSocket('ws://localhost/test', { onMessage });
    rws.open();
    instances[0]._open();
    instances[0]._message('hello');
    expect(onMessage).toHaveBeenCalledWith('hello');
  });

  it('calls onClose when the WS closes', () => {
    const onClose = vi.fn();
    const rws = createReconnectingWebSocket('ws://localhost/test', { onClose });
    rws.open();
    instances[0]._open();
    instances[0]._close(true, 1001);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('sends data when connected', () => {
    const rws = createReconnectingWebSocket('ws://localhost/test');
    rws.open();
    instances[0]._open();
    rws.send('test data');
    expect(instances[0].send).toHaveBeenCalledWith('test data');
  });

  it('queues send only when readyState is OPEN', () => {
    const rws = createReconnectingWebSocket('ws://localhost/test');
    rws.open();
    // Not yet open — send should be no-op
    rws.send('test');
    expect(instances[0].send).not.toHaveBeenCalled();
  });

  it('does nothing on send after intentional close', () => {
    const rws = createReconnectingWebSocket('ws://localhost/test');
    rws.open();
    instances[0]._open();
    rws.close();
    rws.send('after close');
    expect(instances[0].send).not.toHaveBeenCalledWith('after close');
  });

  it('reconnects after unexpected close', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const rws = createReconnectingWebSocket('ws://localhost/test', {
      onOpen,
      onClose,
      minInterval: 100,
      maxInterval: 500,
    });

    rws.open();
    instances[0]._open();
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Unexpected close
    instances[0]._close(false, 1006);
    expect(onClose).toHaveBeenCalledWith(false);

    // Advance past the reconnection delay
    await vi.advanceTimersByTimeAsync(200);
    expect(instances.length).toBeGreaterThanOrEqual(2);

    // Open the new connection
    instances[instances.length - 1]._open();
    expect(onOpen).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('does NOT reconnect after intentional close()', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onOpen = vi.fn();
    const rws = createReconnectingWebSocket('ws://localhost/test', {
      onOpen,
      minInterval: 100,
      maxInterval: 500,
    });

    rws.open();
    instances[0]._open();
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Intentional close
    rws.close();
    instances[0]._close(true, 1000);

    // Advance well past the reconnection delay
    await vi.advanceTimersByTimeAsync(2000);
    expect(instances.length).toBe(1); // No new WS created

    vi.useRealTimers();
  });

  it('returns connected=false before open', () => {
    const rws = createReconnectingWebSocket('ws://localhost/test');
    expect(rws.connected).toBe(false);
  });

  it('returns connected=true after open', () => {
    const rws = createReconnectingWebSocket('ws://localhost/test');
    rws.open();
    instances[0]._open();
    expect(rws.connected).toBe(true);
  });

  it('returns readyState from underlying WS', () => {
    const rws = createReconnectingWebSocket('ws://localhost/test');
    expect(rws.readyState).toBe(WebSocket.CLOSED); // 3
    rws.open();
    instances[0]._open();
    expect(rws.readyState).toBe(WebSocket.OPEN); // 1
  });
});
