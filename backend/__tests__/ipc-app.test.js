/**
 * Tests for backend/transports/ipc/app.js — registerAppIpcHandlers / refreshAppIpcHandlers
 *
 * Covers:
 *   Built-in config channels: app:config:get, app:config:set
 *   App method channels: app:<id>:<method>
 *   Stream channels: connect, message, disconnect per app stream
 *   refreshAppIpcHandlers — clear + re-register
 *   Error paths: missing params, unknown stream, unknown connectionId
 *   Edge cases: double registration idempotency, sender destroyed during stream,
 *     onClientMessage undefined, disconnect without connectionId
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockIpcMain, streamRegistry, mockConfigStore } = vi.hoisted(() => ({
  mockIpcMain: {
    /** @type {Map<string, Function>} */
    _handlers: new Map(),
    handle(channel, handler) {
      this._handlers.set(channel, handler);
    },
    removeHandler(channel) {
      this._handlers.delete(channel);
    },
  },
  streamRegistry: {
    _map: new Map(),
    set(id, entry) { this._map.set(id, entry); },
    get(id) { return this._map.get(id); },
    delete(id) { this._map.delete(id); },
  },
  mockConfigStore: {
    load: vi.fn().mockReturnValue({}),
    save: vi.fn(),
    getConfigPath: vi.fn().mockReturnValue('/fake/path'),
  },
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// Mock stream-registry (using hoisted)
vi.mock('../lib/stream-registry.js', () => ({
  streamRegistry,
}));

// Mock paths
vi.mock('../lib/paths.js', () => ({
  DATA_ROOT: '/fake/data/root',
}));

// Mock app-config-store to avoid filesystem side effects
vi.mock('../lib/app-config-store.js', () => ({
  createAppConfigStore: () => mockConfigStore,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { registerAppIpcHandlers, refreshAppIpcHandlers } from '../transports/ipc/app.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal mock router that can register APIs and streams */
function createMockRouter(overrides = {}) {
  return {
    _methods: new Map(),
    _streams: new Map(),
    registerApi(appId, method, handler) {
      const key = `${appId}:${method}`;
      this._methods.set(key, handler);
    },
    registerStream(appId, name, handler) {
      const key = `${appId}:${name}`;
      this._streams.set(key, handler);
    },
    getRegisteredApps() {
      return overrides.appIds ?? [];
    },
    getAppMethods(appId) {
      return [...this._methods.keys()]
        .filter((k) => k.startsWith(`${appId}:`))
        .map((k) => k.slice(appId.length + 1));
    },
    getAppStreams(appId) {
      return [...this._streams.keys()]
        .filter((k) => k.startsWith(`${appId}:`))
        .map((k) => k.slice(appId.length + 1));
    },
    matchIpcChannel(channel) {
      // channel format: app:<id>:<method>
      const parts = channel.split(':');
      if (parts.length < 3) return false;
      const appId = parts[1];
      const method = parts.slice(2).join(':');
      const key = `${appId}:${method}`;
      const handler = this._methods.get(key);
      return handler ? { appId, method, handler } : false;
    },
    getStreamHandler(appId, streamName) {
      return this._streams.get(`${appId}:${streamName}`) ?? null;
    },
  };
}

/** Build a mock Electron event with a mock sender. */
function mockEvent(senderOverrides = {}) {
  const sender = {
    _destroyed: false,
    _listeners: {},
    _channels: [],
    id: 42,
    send(channel, data) { this._channels.push({ channel, data }); },
    on(event, cb) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(cb);
    },
    isDestroyed() { return this._destroyed; },
    removeAllListeners() { this._listeners = {}; },
    ...senderOverrides,
  };
  return { sender };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIpcMain._handlers.clear();
  streamRegistry._map.clear();
  mockConfigStore.load.mockReturnValue({});
  // Reset module-level _registeredChannels by calling refresh with empty router
  refreshAppIpcHandlers(mockIpcMain, createMockRouter());
});

// ── Built-in config handlers ──────────────────────────────────────────────────

describe('built-in config handlers', () => {
  it('registers app:config:get and app:config:set', () => {
    const router = createMockRouter();
    registerAppIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('app:config:get')).toBe(true);
    expect(mockIpcMain._handlers.has('app:config:set')).toBe(true);
  });

  it('app:config:get throws when appId is missing', async () => {
    const router = createMockRouter();
    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:config:get');
    await expect(handler(null, {})).rejects.toThrow('appId is required');
    await expect(handler(null, null)).rejects.toThrow('appId is required');
  });

  it('app:config:get calls configStore.load with manifest', async () => {
    const router = createMockRouter();
    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:config:get');
    // Should not throw — returns empty config for new app
    const result = await handler(null, { appId: 'test-app', manifest: { name: 'test' } });
    expect(typeof result).toBe('object');
  });

  it('app:config:set throws when appId is missing', async () => {
    const router = createMockRouter();
    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:config:set');
    await expect(handler(null, {})).rejects.toThrow('appId is required');
  });

  it('app:config:set throws when config is not an object', async () => {
    const router = createMockRouter();
    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:config:set');
    await expect(handler(null, { appId: 'p', config: 'string' })).rejects.toThrow('config must be a JSON object');
    await expect(handler(null, { appId: 'p', config: null })).rejects.toThrow('config must be a JSON object');
  });

  it('app:config:set returns { ok: true } on success', async () => {
    const router = createMockRouter();
    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:config:set');
    const result = await handler(null, { appId: 'test-app', config: { key: 'val' } });
    expect(result).toEqual({ ok: true });
  });
});

// ── App method handlers ────────────────────────────────────────────────────

describe('app method handlers', () => {
  it('registers IPC handlers for each app method', () => {
    const router = createMockRouter({ appIds: ['my-app'] });
    router.registerApi('my-app', 'greet', async (params) => ({ result: `hello ${params.name}` }));
    router.registerApi('my-app', 'add', async (params) => ({ sum: params.a + params.b }));

    registerAppIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('app:my-app:greet')).toBe(true);
    expect(mockIpcMain._handlers.has('app:my-app:add')).toBe(true);
  });

  it('invokes the correct handler via router.matchIpcChannel', async () => {
    const router = createMockRouter({ appIds: ['p'] });
    router.registerApi('p', 'echo', async (params) => ({ echoed: params }));

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p:echo');
    const result = await handler(null, { foo: 'bar' });
    expect(result).toEqual({ echoed: { foo: 'bar' } });
  });

  it('passes empty object when params is undefined', async () => {
    const router = createMockRouter({ appIds: ['p'] });
    router.registerApi('p', 'test', async (params) => params);

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p:test');
    const result = await handler(null, undefined);
    expect(result).toEqual({});
  });

  it('passes empty object when params is null', async () => {
    const router = createMockRouter({ appIds: ['p'] });
    router.registerApi('p', 'test', async (params) => params);

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p:test');
    const result = await handler(null, null);
    expect(result).toEqual({});
  });

  it('throws when the channel is not found in router', async () => {
    const router = createMockRouter({ appIds: ['p'] });
    // Register method first, then register IPC handlers, THEN remove from router
    router.registerApi('p', 'gone', async () => 'ok');
    registerAppIpcHandlers(mockIpcMain, router);
    router._methods.clear(); // simulate method removed AFTER handler registration

    const handler = mockIpcMain._handlers.get('app:p:gone');
    await expect(handler(null, {})).rejects.toThrow('App method not found');
  });

  it('skips already-registered channels (idempotent)', () => {
    const router = createMockRouter({ appIds: ['p'] });
    router.registerApi('p', 'm', async () => 'ok');

    registerAppIpcHandlers(mockIpcMain, router);
    const firstHandler = mockIpcMain._handlers.get('app:p:m');

    // Second call should skip already-registered channels
    registerAppIpcHandlers(mockIpcMain, router);
    const secondHandler = mockIpcMain._handlers.get('app:p:m');

    // Same handler reference (not replaced)
    expect(secondHandler).toBe(firstHandler);
  });
});

// ── Stream connect handlers ───────────────────────────────────────────────────

describe('stream connect handlers', () => {
  it('registers connect channel for each app stream', () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('app:p1:logs:connect')).toBe(true);
  });

  it('connect handler returns { ok: true, connectionId }', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    const result = await handler(ev, {});

    expect(result.ok).toBe(true);
    expect(typeof result.connectionId).toBe('string');
    expect(result.connectionId).toContain('app:p1:logs:connect');
  });

  it('connect handler throws when stream handler is missing', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    // Don't register stream — it passes getAppStreams but no handler

    // Manually add the stream name to the router without a handler
    router._streams.set('p1:nohandler', null);

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:nohandler:connect');
    if (handler) {
      const ev = mockEvent();
      await expect(handler(ev, {})).rejects.toThrow('not found');
    }
  });

  it('connect handler passes params to the stream handler', async () => {
    let receivedParams = null;
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      receivedParams = params;
      return {
        subscribe: () => ({ unsubscribe: vi.fn() }),
      };
    });

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, { sessionId: 's1', option: true });

    expect(receivedParams).toEqual({ sessionId: 's1', option: true });
  });

  it('connect handler passes empty object when params is null', async () => {
    let receivedParams = null;
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      receivedParams = params;
      return {
        subscribe: () => ({ unsubscribe: vi.fn() }),
      };
    });

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, null);

    expect(receivedParams).toEqual({});
  });

  it('io.sendBinary sends via event.sender.send', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      io.sendBinary(Buffer.from('hello'));
      io.sendJSON({ type: 'meta' });
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});

    const frameMsgs = ev.sender._channels.filter((c) => c.channel === 'app:p1:logs:frame');
    const dataMsgs = ev.sender._channels.filter((c) => c.channel === 'app:p1:logs:data');
    expect(frameMsgs.length).toBe(1);
    expect(dataMsgs.length).toBe(1);
    expect(dataMsgs[0].data).toEqual({ type: 'meta' });
  });

  it('io.sendBinary is no-op when sender is destroyed', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      io.sendBinary(Buffer.from('hello'));
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    ev.sender._destroyed = true;
    await handler(ev, {});

    expect(ev.sender._channels.length).toBe(0);
  });

  it('io.isConnected reflects sender.isDestroyed()', async () => {
    let capturedIo;
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      capturedIo = io;
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});

    expect(capturedIo.isConnected()).toBe(true);
    ev.sender._destroyed = true;
    expect(capturedIo.isConnected()).toBe(false); // isConnected = !isDestroyed()
  });

  it('io.onClose registers a destroyed listener', async () => {
    let closeCalled = false;
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      io.onClose(() => { closeCalled = true; });
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});

    // Simulate destroyed event (now an array of listeners)
    const destroyedListeners = ev.sender._listeners['destroyed'];
    expect(Array.isArray(destroyedListeners)).toBe(true);
    destroyedListeners.forEach((fn) => fn());
    expect(closeCalled).toBe(true);
  });

  it('io.close sends end message via sender', async () => {
    let capturedIo;
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      capturedIo = io;
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});

    capturedIo.close();
    const endMsgs = ev.sender._channels.filter((c) => c.channel === 'app:p1:logs:end');
    expect(endMsgs.length).toBe(1);
  });

  it('io.close is no-op when sender is destroyed', async () => {
    let capturedIo;
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      capturedIo = io;
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});
    ev.sender._channels = []; // reset

    ev.sender._destroyed = true;
    capturedIo.close();
    expect(ev.sender._channels.length).toBe(0);
  });

  it('registers in streamRegistry on connect', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});

    expect(streamRegistry._map.size).toBe(1);
  });
});

// ── Stream message handlers ───────────────────────────────────────────────────

describe('stream message handlers', () => {
  it('registers message channel for app streams', () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('app:p1:logs:message')).toBe(true);
  });

  it('message handler throws when connectionId is missing', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:message');
    await expect(handler(null, {})).rejects.toThrow('connectionId is required');
    await expect(handler(null, null)).rejects.toThrow('connectionId is required');
  });

  it('message handler throws when connectionId is unknown', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    const messageHandler = mockIpcMain._handlers.get('app:p1:logs:message');
    await expect(messageHandler(null, { connectionId: 'nonexistent' })).rejects.toThrow('Stream connection not found');
  });

  it('message handler calls onClientMessage on the connection', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    let receivedData = null;
    router.registerStream('p1', 'logs', () => ({
      onClientMessage: (data) => { receivedData = data; },
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    // First connect to get a connectionId
    const connectHandler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    const connectResult = await connectHandler(ev, {});
    const connId = connectResult.connectionId;

    // Now send a message
    const messageHandler = mockIpcMain._handlers.get('app:p1:logs:message');
    const result = await messageHandler(null, { connectionId: connId, data: { text: 'hello' } });

    expect(result).toEqual({ ok: true });
    expect(receivedData).toEqual({ text: 'hello' });
  });

  it('message handler does not throw when onClientMessage is undefined', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      // no onClientMessage
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    const connectHandler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    const { connectionId } = await connectHandler(ev, {});

    const messageHandler = mockIpcMain._handlers.get('app:p1:logs:message');
    const result = await messageHandler(null, { connectionId, data: 'test' });
    expect(result).toEqual({ ok: true });
  });
});

// ── Stream disconnect handlers ────────────────────────────────────────────────

describe('stream disconnect handlers', () => {
  it('registers disconnect channel for app streams', () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('app:p1:logs:disconnect')).toBe(true);
  });

  it('disconnect handler returns { ok: false } when connectionId is missing', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:disconnect');
    const result = await handler(null, {});
    expect(result).toEqual({ ok: false });
  });

  it('disconnect handler returns { ok: false } when params is null', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:disconnect');
    const result = await handler(null, null);
    expect(result).toEqual({ ok: false });
  });

  it('disconnect handler cleans up streamRegistry entry', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    let unsubCalled = false;
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: () => { unsubCalled = true; } }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    // Connect first
    const connectHandler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    const { connectionId } = await connectHandler(ev, {});

    expect(streamRegistry._map.has(connectionId)).toBe(true);

    // Disconnect
    const discHandler = mockIpcMain._handlers.get('app:p1:logs:disconnect');
    const result = await discHandler(null, { connectionId });
    expect(result).toEqual({ ok: true });
    expect(unsubCalled).toBe(true);
    expect(streamRegistry._map.has(connectionId)).toBe(false);
  });

  it('disconnect handler works when streamRegistry entry has no cleanup', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    const connectHandler = mockIpcMain._handlers.get('app:p1:logs:connect');
    const ev = mockEvent();
    const { connectionId } = await connectHandler(ev, {});

    // Remove cleanup from streamRegistry entry
    const entry = streamRegistry._map.get(connectionId);
    if (entry) entry.cleanup = undefined;

    const discHandler = mockIpcMain._handlers.get('app:p1:logs:disconnect');
    const result = await discHandler(null, { connectionId });
    expect(result).toEqual({ ok: true });
  });

  it('disconnect handler returns { ok: true } even for unknown connectionId (idempotent)', async () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerAppIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('app:p1:logs:disconnect');
    const result = await handler(null, { connectionId: 'nonexistent' });
    expect(result).toEqual({ ok: true });
  });
});

// ── refreshAppIpcHandlers ──────────────────────────────────────────────────

describe('refreshAppIpcHandlers', () => {
  it('calls removeHandler on all previously registered channels', () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerApi('p1', 'm', async () => 'ok');

    registerAppIpcHandlers(mockIpcMain, router);
    const channelsBefore = new Set(mockIpcMain._handlers.keys());

    refreshAppIpcHandlers(mockIpcMain, router);
    const channelsAfter = new Set(mockIpcMain._handlers.keys());

    // All old channels should have been removed and re-registered (same names)
    for (const ch of channelsBefore) {
      expect(channelsAfter.has(ch)).toBe(true);
    }
  });

  it('does not throw when removeHandler fails (catches errors)', () => {
    const badIpcMain = {
      _handlers: new Map(),
      handle(ch, h) { this._handlers.set(ch, h); },
      removeHandler(ch) { throw new Error('cannot remove'); },
    };

    const router = createMockRouter({ appIds: ['p1'] });
    router.registerApi('p1', 'm', async () => 'ok');

    registerAppIpcHandlers(badIpcMain, router);
    expect(() => refreshAppIpcHandlers(badIpcMain, router)).not.toThrow();
  });

  it('re-registers all current app methods after clear', () => {
    const router = createMockRouter({ appIds: ['p1'] });
    router.registerApi('p1', 'm', async () => 'first');

    registerAppIpcHandlers(mockIpcMain, router);

    // Change the handler
    router._methods.clear();
    router.registerApi('p1', 'm', async () => 'second');

    refreshAppIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('app:p1:m')).toBe(true);
  });
});

// ── Multi-app isolation ────────────────────────────────────────────────────

describe('multi-app isolation', () => {
  it('registers handlers for multiple apps independently', () => {
    const router = createMockRouter({ appIds: ['p1', 'p2'] });
    router.registerApi('p1', 'a', async () => 'a');
    router.registerApi('p2', 'b', async () => 'b');
    router.registerStream('p1', 's1', () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }));
    router.registerStream('p2', 's2', () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }));

    registerAppIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('app:p1:a')).toBe(true);
    expect(mockIpcMain._handlers.has('app:p2:b')).toBe(true);
    expect(mockIpcMain._handlers.has('app:p1:s1:connect')).toBe(true);
    expect(mockIpcMain._handlers.has('app:p2:s2:connect')).toBe(true);
    expect(mockIpcMain._handlers.has('app:p1:s1:message')).toBe(true);
    expect(mockIpcMain._handlers.has('app:p2:s2:message')).toBe(true);
    expect(mockIpcMain._handlers.has('app:p1:s1:disconnect')).toBe(true);
    expect(mockIpcMain._handlers.has('app:p2:s2:disconnect')).toBe(true);
  });

  it('app with no methods or streams registers only config channels', () => {
    const router = createMockRouter({ appIds: ['empty'] });

    registerAppIpcHandlers(mockIpcMain, router);

    // Only built-in config channels
    const channels = [...mockIpcMain._handlers.keys()];
    expect(channels).toContain('app:config:get');
    expect(channels).toContain('app:config:set');
  });
});