/**
 * Comprehensive integration tests for browser streaming pipeline.
 *
 * Tests both IPC and HTTP adapter streaming paths end-to-end, verifying
 * that binary frame data flows correctly from the adapter to the consumer
 * callbacks (matching what BrowserLiveView receives).
 *
 * Key risk areas:
 *   - `toArrayBuffer` cross-realm type detection (Electron contextBridge)
 *   - WebSocket binary frame handling in HTTP adapter
 *   - Frame deduplication and ordering
 *   - Connection lifecycle (start/stop/cleanup)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrowserStreamCallbacks } from '../types';

// ═════════════════════════════════════════════════════════════════════════════
// 1. toArrayBuffer — cross-realm safe binary detection
// ═════════════════════════════════════════════════════════════════════════════

describe('toArrayBuffer (cross-realm safe)', () => {
  let mockElectronAPI: any;
  let adapter: any;

  beforeEach(async () => {
    mockElectronAPI = {
      isElectron: true,
      invoke: vi.fn().mockResolvedValue({ ok: true }),
      on: vi.fn().mockReturnValue(vi.fn()),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    (globalThis as any).window = { electronAPI: mockElectronAPI };

    const { createIpcBrowserAdapter } = await import(
      // @ts-expect-error — ipcAdapter only exists in Electron build
      '../ipcAdapter'
    );
    adapter = createIpcBrowserAdapter();
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  /** Capture the frame handler and call it, returning what onFrame receives. */
  function fireFrame(data: unknown): unknown {
    const onFrame = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame,
      onMessage: vi.fn(),
      onStateChange: vi.fn(),
    };

    adapter.connectStream('test-id', callbacks);

    const frameHandler = mockElectronAPI.on.mock.calls.find(
      (c: string[]) => c[0] === 'browser:stream:frame',
    )?.[1];
    expect(frameHandler).toBeDefined();
    frameHandler(data);
    return onFrame.mock.calls[0]?.[0] ?? null;
  }

  it('passes ArrayBuffer through directly', () => {
    const ab = new ArrayBuffer(8);
    const result = fireFrame(ab);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result).toBe(ab);
  });

  it('converts Uint8Array to ArrayBuffer with correct bytes', () => {
    const uint8 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const result = fireFrame(uint8) as ArrayBuffer;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result)).toEqual(uint8);
  });

  it('converts Uint8Array subarray correctly (non-zero byteOffset)', () => {
    const full = new Uint8Array([0, 0, 0, 0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const sub = new Uint8Array(full.buffer, 3, 4);
    expect(sub.byteOffset).toBe(3);
    expect(sub.length).toBe(4);

    const result = fireFrame(sub) as ArrayBuffer;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(4);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  });

  it('converts SharedArrayBuffer by copying', () => {
    const sab = new SharedArrayBuffer(4);
    const view = new Uint8Array(sab);
    view.set([0xff, 0xd8, 0xff, 0xe0]);

    const result = fireFrame(sab) as ArrayBuffer;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(4);
    expect(result).not.toBe(sab);
    expect(new Uint8Array(result)).toEqual(view);
  });

  it('handles empty Uint8Array', () => {
    const result = fireFrame(new Uint8Array(0)) as ArrayBuffer;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(0);
  });

  it('handles large binary data (simulating JPEG frame)', () => {
    const size = 100_000;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = i & 0xff;
    }

    const result = fireFrame(data) as ArrayBuffer;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(size);
    expect(new Uint8Array(result)).toEqual(data);
  });

  it('cross-realm simulation: passes Uint8Array even when prototype is missing', () => {
    const buf = new ArrayBuffer(4);
    const view = new Uint8Array(buf);
    view.set([0xff, 0xd8, 0xff, 0xe0]);

    const fake = Object.assign(Object.create(null), {
      buffer: buf,
      byteOffset: view.byteOffset,
      byteLength: view.byteLength,
      length: view.length,
      [Symbol.toStringTag]: 'Uint8Array',
    });

    const result = fireFrame(fake) as ArrayBuffer;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(4);
    expect(new Uint8Array(result)).toEqual(view);
  });

  it('returns null for null input (no frame callback)', () => {
    const onFrame = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame,
      onMessage: vi.fn(),
      onStateChange: vi.fn(),
    };

    adapter.connectStream('test-id', callbacks);
    const frameHandler = mockElectronAPI.on.mock.calls.find(
      (c: string[]) => c[0] === 'browser:stream:frame',
    )?.[1];

    frameHandler(null);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('returns null for undefined input', () => {
    const onFrame = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame,
      onMessage: vi.fn(),
      onStateChange: vi.fn(),
    };

    adapter.connectStream('test-id', callbacks);
    const frameHandler = mockElectronAPI.on.mock.calls.find(
      (c: string[]) => c[0] === 'browser:stream:frame',
    )?.[1];

    frameHandler(undefined);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('returns null for plain object input', () => {
    const onFrame = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame,
      onMessage: vi.fn(),
      onStateChange: vi.fn(),
    };

    adapter.connectStream('test-id', callbacks);
    const frameHandler = mockElectronAPI.on.mock.calls.find(
      (c: string[]) => c[0] === 'browser:stream:frame',
    )?.[1];

    frameHandler({ some: 'object' });
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('returns null for string input', () => {
    const result = fireFrame('not binary');
    expect(result).toBeNull();
  });

  it('returns null for number input', () => {
    const result = fireFrame(42);
    expect(result).toBeNull();
  });

  it('converts Uint8ClampedArray to ArrayBuffer', () => {
    const clamped = new Uint8ClampedArray([100, 200, 255, 0]);
    const result = fireFrame(clamped) as ArrayBuffer;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(4);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([100, 200, 255, 0]));
  });

  it('converts DataView to ArrayBuffer', () => {
    const ab = new ArrayBuffer(4);
    const view = new DataView(ab);
    view.setUint32(0, 0xffd8ffe0);
    const result = fireFrame(view) as ArrayBuffer;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(4);
    expect(new Uint8Array(result)).toEqual(new Uint8Array(ab));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. IPC connectStream — full lifecycle
// ═════════════════════════════════════════════════════════════════════════════

describe('IPC connectStream — lifecycle', () => {
  let mockElectronAPI: any;
  let adapter: any;

  beforeEach(async () => {
    mockElectronAPI = {
      isElectron: true,
      invoke: vi.fn().mockResolvedValue({ ok: true }),
      on: vi.fn().mockReturnValue(vi.fn()),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    (globalThis as any).window = { electronAPI: mockElectronAPI };


    const { createIpcBrowserAdapter } = await import(
      // @ts-expect-error — same file
      '../ipcAdapter'
    );
    adapter = createIpcBrowserAdapter();
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('routes frame data correctly through IPC → onFrame pipeline', () => {
    const onFrame = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame,
      onMessage: vi.fn(),
      onStateChange: vi.fn(),
    };

    adapter.connectStream('b1', callbacks);

    const frameHandler = mockElectronAPI.on.mock.calls.find(
      (c: string[]) => c[0] === 'browser:stream:frame',
    )?.[1];

    const frame1 = new Uint8Array([0xff, 0xd8, 0xff]);
    const frame2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    frameHandler(frame1);
    frameHandler(frame2);

    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onFrame.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
    expect(onFrame.mock.calls[1][0]).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(onFrame.mock.calls[0][0])).toEqual(frame1);
    expect(new Uint8Array(onFrame.mock.calls[1][0])).toEqual(frame2);
  });

  it('routes JSON messages to onMessage', () => {
    const onMessage = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage,
      onStateChange: vi.fn(),
    };

    adapter.connectStream('b1', callbacks);

    const msgHandler = mockElectronAPI.on.mock.calls.find(
      (c: string[]) => c[0] === 'browser:stream:message',
    )?.[1];

    const infoMsg = { type: 'info', url: 'https://example.com', title: 'Example' };
    msgHandler(infoMsg);

    expect(onMessage).toHaveBeenCalledWith(infoMsg);
  });

  it('calls onStateChange(true) on first frame, not on connect', () => {
    const onStateChange = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage: vi.fn(),
      onStateChange,
    };

    adapter.connectStream('b1', callbacks);

    expect(onStateChange).not.toHaveBeenCalledWith(true);

    const frameHandler = mockElectronAPI.on.mock.calls.find(
      (c: string[]) => c[0] === 'browser:stream:frame',
    )?.[1];
    frameHandler(new Uint8Array([0xff, 0xd8]));

    expect(onStateChange).toHaveBeenCalledWith(true);
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it('calls onStateChange(true) on first message if no frames arrive', () => {
    const onStateChange = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage: vi.fn(),
      onStateChange,
    };

    adapter.connectStream('b1', callbacks);

    const msgHandler = mockElectronAPI.on.mock.calls.find(
      (c: string[]) => c[0] === 'browser:stream:message',
    )?.[1];
    msgHandler({ type: 'info', url: 'https://x.com', title: 'X' });

    expect(onStateChange).toHaveBeenCalledWith(true);
  });

  it('calls onStateChange(false) on close and stops stream', () => {
    const onStateChange = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage: vi.fn(),
      onStateChange,
    };

    const conn = adapter.connectStream('b1', callbacks);
    conn.close();

    expect(onStateChange).toHaveBeenCalledWith(false);
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith('browser:stream:stop', { id: 'b1' });
  });

  it('cleanup: removes IPC listeners on close', () => {
    const unsubFrame = vi.fn();
    const unsubMsg = vi.fn();
    mockElectronAPI.on = vi.fn(() => vi.fn());
    mockElectronAPI.on
      .mockReturnValueOnce(unsubFrame)
      .mockReturnValueOnce(unsubMsg);

    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage: vi.fn(),
      onStateChange: vi.fn(),
    };

    const conn = adapter.connectStream('b1', callbacks);
    conn.close();

    expect(unsubFrame).toHaveBeenCalled();
    expect(unsubMsg).toHaveBeenCalled();
  });

  it('supports multiple connect/disconnect cycles without leaks', () => {
    for (let i = 0; i < 3; i++) {
      mockElectronAPI.invoke = vi.fn().mockResolvedValue({ ok: true });
      mockElectronAPI.on = vi.fn().mockReturnValue(vi.fn());

      const callbacks: BrowserStreamCallbacks = {
        onFrame: vi.fn(),
        onMessage: vi.fn(),
        onStateChange: vi.fn(),
      };

      const conn = adapter.connectStream(`b${i}`, callbacks);

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('browser:stream:start', {
        id: `b${i}`,
        config: { fps: 24, quality: 80 },
      });

      conn.close();

      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('browser:stream:stop', {
        id: `b${i}`,
      });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HTTP/WebSocket connectStream — binary frame handling
// ═════════════════════════════════════════════════════════════════════════════

describe('HTTP connectStream — binary frame handling', () => {
  let mockInstances: any[];
  let adapter: any;

  beforeEach(async () => {
    mockInstances = [];

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.CONNECTING;
      binaryType = 'arraybuffer';
      onopen: (() => void) | null = null;
      onclose: ((ev: { wasClean: boolean; code: number; reason: string }) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      send = vi.fn();
      close = vi.fn();

      constructor(_url: string) {
        this.send = vi.fn();
        this.close = vi.fn((code?: number) => {
          this.readyState = MockWebSocket.CLOSED;
          this.onclose?.({ wasClean: true, code: code ?? 1000, reason: '' });
        });

        const instance = this;
        const proxy = {
          send: this.send,
          close: this.close,
          _open() { instance.readyState = MockWebSocket.OPEN; instance.onopen?.(); },
          _close(wasClean = true, code = 1000) {
            instance.readyState = MockWebSocket.CLOSED;
            instance.onclose?.({ wasClean, code, reason: '' });
          },
          _message(data: unknown) { instance.onmessage?.({ data }); },
        };
        mockInstances.push(proxy);
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;

    Object.defineProperty(globalThis, 'location', {
      value: { host: 'localhost:5173', protocol: 'http:' },
      writable: true,
      configurable: true,
    });

    const { createHttpBrowserAdapter } = await import(
      // @ts-expect-error — adapter only exists in HTTP build
      '../adapter'
    );
    adapter = createHttpBrowserAdapter({ baseUrl: '/api' });
  });

  afterEach(() => {
    delete (globalThis as any).WebSocket;
    delete (globalThis as any).location;
  });

  it('passes ArrayBuffer binary data to onFrame', () => {
    const onFrame = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame,
      onMessage: vi.fn(),
      onStateChange: vi.fn(),
    };

    adapter.connectStream('b1', callbacks);
    mockInstances[0]._open();

    const jpegData = new ArrayBuffer(16);
    mockInstances[0]._message(jpegData);

    expect(onFrame).toHaveBeenCalledWith(jpegData);
  });

  it('parses JSON text messages to onMessage', () => {
    const onMessage = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage,
      onStateChange: vi.fn(),
    };

    adapter.connectStream('b1', callbacks);
    mockInstances[0]._open();

    const msg = { type: 'info', url: 'https://x.com', title: 'X' };
    mockInstances[0]._message(JSON.stringify(msg));

    expect(onMessage).toHaveBeenCalledWith(msg);
  });

  it('handles interleaved binary frames and text messages', () => {
    const onFrame = vi.fn();
    const onMessage = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame,
      onMessage,
      onStateChange: vi.fn(),
    };

    adapter.connectStream('b1', callbacks);
    mockInstances[0]._open();

    mockInstances[0]._message(JSON.stringify({ type: 'info', url: 'https://x.com', title: 'X' }));
    expect(onMessage).toHaveBeenCalledTimes(1);

    const frame1 = new ArrayBuffer(4);
    mockInstances[0]._message(frame1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith(frame1);

    mockInstances[0]._message(JSON.stringify({ type: 'info', url: 'https://y.com', title: 'Y' }));
    expect(onMessage).toHaveBeenCalledTimes(2);

    const frame2 = new ArrayBuffer(8);
    mockInstances[0]._message(frame2);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledWith(frame2);
  });

  it('sends config on open', () => {
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage: vi.fn(),
      onStateChange: vi.fn(),
    };

    adapter.connectStream('b1', callbacks, { fps: 15, quality: 60 });
    mockInstances[0]._open();

    expect(mockInstances[0].send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'updateConfig', config: { fps: 15, quality: 60 } }),
    );
  });

  it('calls onStateChange(true) on WS open', () => {
    const onStateChange = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage: vi.fn(),
      onStateChange,
    };

    adapter.connectStream('b1', callbacks);
    mockInstances[0]._open();

    expect(onStateChange).toHaveBeenCalledWith(true);
  });

  it('calls onStateChange(false) on WS close', () => {
    const onStateChange = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage: vi.fn(),
      onStateChange,
    };

    adapter.connectStream('b1', callbacks);
    mockInstances[0]._open();
    mockInstances[0]._close();

    expect(onStateChange).toHaveBeenCalledWith(false);
  });

  it('sends input events as JSON over WS', () => {
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage: vi.fn(),
      onStateChange: vi.fn(),
    };

    const conn = adapter.connectStream('b1', callbacks);
    mockInstances[0]._open();

    conn.send({ type: 'mousemove', x: 0.5, y: 0.5 });

    expect(mockInstances[0].send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'mousemove', x: 0.5, y: 0.5 }),
    );
  });

  it('closes WS and calls onStateChange(false) on close()', () => {
    const onStateChange = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame: vi.fn(),
      onMessage: vi.fn(),
      onStateChange,
    };

    const conn = adapter.connectStream('b1', callbacks);
    mockInstances[0]._open();
    conn.close();

    expect(mockInstances[0].close).toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalledWith(false);
  });

  it('malformed JSON in text message does not crash the stream', () => {
    const onFrame = vi.fn();
    const onMessage = vi.fn();
    const onStateChange = vi.fn();
    const callbacks: BrowserStreamCallbacks = {
      onFrame,
      onMessage,
      onStateChange,
    };

    adapter.connectStream('b1', callbacks);
    mockInstances[0]._open();

    mockInstances[0]._message('not json');
    expect(onMessage).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalledWith(false);

    mockInstances[0]._message(JSON.stringify({ type: 'info', url: 'https://x.com', title: 'X' }));
    expect(onMessage).toHaveBeenCalledTimes(1);
  });
});
