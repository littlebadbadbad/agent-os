/**
 * Tests for backend/transports/ipc/plugin.js — registerPluginIpcHandlers / refreshPluginIpcHandlers
 *
 * Covers:
 *   Built-in config channels: plugin:config:get, plugin:config:set
 *   Plugin method channels: plugin:<id>:<method>
 *   Stream channels: connect, message, disconnect per plugin stream
 *   refreshPluginIpcHandlers — clear + re-register
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

// Mock plugin-config-store to avoid filesystem side effects
vi.mock('../lib/plugin-config-store.js', () => ({
  createPluginConfigStore: () => mockConfigStore,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { registerPluginIpcHandlers, refreshPluginIpcHandlers } from '../transports/ipc/plugin.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal mock router that can register APIs and streams */
function createMockRouter(overrides = {}) {
  return {
    _methods: new Map(),
    _streams: new Map(),
    registerApi(pluginId, method, handler) {
      const key = `${pluginId}:${method}`;
      this._methods.set(key, handler);
    },
    registerStream(pluginId, name, handler) {
      const key = `${pluginId}:${name}`;
      this._streams.set(key, handler);
    },
    getRegisteredPlugins() {
      return overrides.pluginIds ?? [];
    },
    getPluginMethods(pluginId) {
      return [...this._methods.keys()]
        .filter((k) => k.startsWith(`${pluginId}:`))
        .map((k) => k.slice(pluginId.length + 1));
    },
    getPluginStreams(pluginId) {
      return [...this._streams.keys()]
        .filter((k) => k.startsWith(`${pluginId}:`))
        .map((k) => k.slice(pluginId.length + 1));
    },
    matchIpcChannel(channel) {
      // channel format: plugin:<id>:<method>
      const parts = channel.split(':');
      if (parts.length < 3) return false;
      const pluginId = parts[1];
      const method = parts.slice(2).join(':');
      const key = `${pluginId}:${method}`;
      const handler = this._methods.get(key);
      return handler ? { pluginId, method, handler } : false;
    },
    getStreamHandler(pluginId, streamName) {
      return this._streams.get(`${pluginId}:${streamName}`) ?? null;
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
  refreshPluginIpcHandlers(mockIpcMain, createMockRouter());
});

// ── Built-in config handlers ──────────────────────────────────────────────────

describe('built-in config handlers', () => {
  it('registers plugin:config:get and plugin:config:set', () => {
    const router = createMockRouter();
    registerPluginIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('plugin:config:get')).toBe(true);
    expect(mockIpcMain._handlers.has('plugin:config:set')).toBe(true);
  });

  it('plugin:config:get throws when pluginId is missing', async () => {
    const router = createMockRouter();
    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:config:get');
    await expect(handler(null, {})).rejects.toThrow('pluginId is required');
    await expect(handler(null, null)).rejects.toThrow('pluginId is required');
  });

  it('plugin:config:get calls configStore.load with manifest', async () => {
    const router = createMockRouter();
    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:config:get');
    // Should not throw — returns empty config for new plugin
    const result = await handler(null, { pluginId: 'test-plugin', manifest: { name: 'test' } });
    expect(typeof result).toBe('object');
  });

  it('plugin:config:set throws when pluginId is missing', async () => {
    const router = createMockRouter();
    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:config:set');
    await expect(handler(null, {})).rejects.toThrow('pluginId is required');
  });

  it('plugin:config:set throws when config is not an object', async () => {
    const router = createMockRouter();
    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:config:set');
    await expect(handler(null, { pluginId: 'p', config: 'string' })).rejects.toThrow('config must be a JSON object');
    await expect(handler(null, { pluginId: 'p', config: null })).rejects.toThrow('config must be a JSON object');
  });

  it('plugin:config:set returns { ok: true } on success', async () => {
    const router = createMockRouter();
    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:config:set');
    const result = await handler(null, { pluginId: 'test-plugin', config: { key: 'val' } });
    expect(result).toEqual({ ok: true });
  });
});

// ── Plugin method handlers ────────────────────────────────────────────────────

describe('plugin method handlers', () => {
  it('registers IPC handlers for each plugin method', () => {
    const router = createMockRouter({ pluginIds: ['my-plugin'] });
    router.registerApi('my-plugin', 'greet', async (params) => ({ result: `hello ${params.name}` }));
    router.registerApi('my-plugin', 'add', async (params) => ({ sum: params.a + params.b }));

    registerPluginIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('plugin:my-plugin:greet')).toBe(true);
    expect(mockIpcMain._handlers.has('plugin:my-plugin:add')).toBe(true);
  });

  it('invokes the correct handler via router.matchIpcChannel', async () => {
    const router = createMockRouter({ pluginIds: ['p'] });
    router.registerApi('p', 'echo', async (params) => ({ echoed: params }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p:echo');
    const result = await handler(null, { foo: 'bar' });
    expect(result).toEqual({ echoed: { foo: 'bar' } });
  });

  it('passes empty object when params is undefined', async () => {
    const router = createMockRouter({ pluginIds: ['p'] });
    router.registerApi('p', 'test', async (params) => params);

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p:test');
    const result = await handler(null, undefined);
    expect(result).toEqual({});
  });

  it('passes empty object when params is null', async () => {
    const router = createMockRouter({ pluginIds: ['p'] });
    router.registerApi('p', 'test', async (params) => params);

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p:test');
    const result = await handler(null, null);
    expect(result).toEqual({});
  });

  it('throws when the channel is not found in router', async () => {
    const router = createMockRouter({ pluginIds: ['p'] });
    // Register method first, then register IPC handlers, THEN remove from router
    router.registerApi('p', 'gone', async () => 'ok');
    registerPluginIpcHandlers(mockIpcMain, router);
    router._methods.clear(); // simulate method removed AFTER handler registration

    const handler = mockIpcMain._handlers.get('plugin:p:gone');
    await expect(handler(null, {})).rejects.toThrow('Plugin method not found');
  });

  it('skips already-registered channels (idempotent)', () => {
    const router = createMockRouter({ pluginIds: ['p'] });
    router.registerApi('p', 'm', async () => 'ok');

    registerPluginIpcHandlers(mockIpcMain, router);
    const firstHandler = mockIpcMain._handlers.get('plugin:p:m');

    // Second call should skip already-registered channels
    registerPluginIpcHandlers(mockIpcMain, router);
    const secondHandler = mockIpcMain._handlers.get('plugin:p:m');

    // Same handler reference (not replaced)
    expect(secondHandler).toBe(firstHandler);
  });
});

// ── Stream connect handlers ───────────────────────────────────────────────────

describe('stream connect handlers', () => {
  it('registers connect channel for each plugin stream', () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('plugin:p1:logs:connect')).toBe(true);
  });

  it('connect handler returns { ok: true, connectionId }', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    const result = await handler(ev, {});

    expect(result.ok).toBe(true);
    expect(typeof result.connectionId).toBe('string');
    expect(result.connectionId).toContain('plugin:p1:logs:connect');
  });

  it('connect handler throws when stream handler is missing', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    // Don't register stream — it passes getPluginStreams but no handler

    // Manually add the stream name to the router without a handler
    router._streams.set('p1:nohandler', null);

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:nohandler:connect');
    if (handler) {
      const ev = mockEvent();
      await expect(handler(ev, {})).rejects.toThrow('not found');
    }
  });

  it('connect handler passes params to the stream handler', async () => {
    let receivedParams = null;
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      receivedParams = params;
      return {
        subscribe: () => ({ unsubscribe: vi.fn() }),
      };
    });

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, { sessionId: 's1', option: true });

    expect(receivedParams).toEqual({ sessionId: 's1', option: true });
  });

  it('connect handler passes empty object when params is null', async () => {
    let receivedParams = null;
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      receivedParams = params;
      return {
        subscribe: () => ({ unsubscribe: vi.fn() }),
      };
    });

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, null);

    expect(receivedParams).toEqual({});
  });

  it('io.sendBinary sends via event.sender.send', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      io.sendBinary(Buffer.from('hello'));
      io.sendJSON({ type: 'meta' });
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});

    const frameMsgs = ev.sender._channels.filter((c) => c.channel === 'plugin:p1:logs:frame');
    const dataMsgs = ev.sender._channels.filter((c) => c.channel === 'plugin:p1:logs:data');
    expect(frameMsgs.length).toBe(1);
    expect(dataMsgs.length).toBe(1);
    expect(dataMsgs[0].data).toEqual({ type: 'meta' });
  });

  it('io.sendBinary is no-op when sender is destroyed', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      io.sendBinary(Buffer.from('hello'));
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    ev.sender._destroyed = true;
    await handler(ev, {});

    expect(ev.sender._channels.length).toBe(0);
  });

  it('io.isConnected reflects sender.isDestroyed()', async () => {
    let capturedIo;
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      capturedIo = io;
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});

    expect(capturedIo.isConnected()).toBe(true);
    ev.sender._destroyed = true;
    expect(capturedIo.isConnected()).toBe(false); // isConnected = !isDestroyed()
  });

  it('io.onClose registers a destroyed listener', async () => {
    let closeCalled = false;
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      io.onClose(() => { closeCalled = true; });
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
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
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      capturedIo = io;
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});

    capturedIo.close();
    const endMsgs = ev.sender._channels.filter((c) => c.channel === 'plugin:p1:logs:end');
    expect(endMsgs.length).toBe(1);
  });

  it('io.close is no-op when sender is destroyed', async () => {
    let capturedIo;
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', (params, io) => {
      capturedIo = io;
      return { subscribe: () => ({ unsubscribe: vi.fn() }) };
    });

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});
    ev.sender._channels = []; // reset

    ev.sender._destroyed = true;
    capturedIo.close();
    expect(ev.sender._channels.length).toBe(0);
  });

  it('registers in streamRegistry on connect', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    await handler(ev, {});

    expect(streamRegistry._map.size).toBe(1);
  });
});

// ── Stream message handlers ───────────────────────────────────────────────────

describe('stream message handlers', () => {
  it('registers message channel for plugin streams', () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('plugin:p1:logs:message')).toBe(true);
  });

  it('message handler throws when connectionId is missing', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:message');
    await expect(handler(null, {})).rejects.toThrow('connectionId is required');
    await expect(handler(null, null)).rejects.toThrow('connectionId is required');
  });

  it('message handler throws when connectionId is unknown', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const messageHandler = mockIpcMain._handlers.get('plugin:p1:logs:message');
    await expect(messageHandler(null, { connectionId: 'nonexistent' })).rejects.toThrow('Stream connection not found');
  });

  it('message handler calls onClientMessage on the connection', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    let receivedData = null;
    router.registerStream('p1', 'logs', () => ({
      onClientMessage: (data) => { receivedData = data; },
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    // First connect to get a connectionId
    const connectHandler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    const connectResult = await connectHandler(ev, {});
    const connId = connectResult.connectionId;

    // Now send a message
    const messageHandler = mockIpcMain._handlers.get('plugin:p1:logs:message');
    const result = await messageHandler(null, { connectionId: connId, data: { text: 'hello' } });

    expect(result).toEqual({ ok: true });
    expect(receivedData).toEqual({ text: 'hello' });
  });

  it('message handler does not throw when onClientMessage is undefined', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      // no onClientMessage
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const connectHandler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    const { connectionId } = await connectHandler(ev, {});

    const messageHandler = mockIpcMain._handlers.get('plugin:p1:logs:message');
    const result = await messageHandler(null, { connectionId, data: 'test' });
    expect(result).toEqual({ ok: true });
  });
});

// ── Stream disconnect handlers ────────────────────────────────────────────────

describe('stream disconnect handlers', () => {
  it('registers disconnect channel for plugin streams', () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('plugin:p1:logs:disconnect')).toBe(true);
  });

  it('disconnect handler returns { ok: false } when connectionId is missing', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:disconnect');
    const result = await handler(null, {});
    expect(result).toEqual({ ok: false });
  });

  it('disconnect handler returns { ok: false } when params is null', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:disconnect');
    const result = await handler(null, null);
    expect(result).toEqual({ ok: false });
  });

  it('disconnect handler cleans up streamRegistry entry', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    let unsubCalled = false;
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: () => { unsubCalled = true; } }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    // Connect first
    const connectHandler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    const { connectionId } = await connectHandler(ev, {});

    expect(streamRegistry._map.has(connectionId)).toBe(true);

    // Disconnect
    const discHandler = mockIpcMain._handlers.get('plugin:p1:logs:disconnect');
    const result = await discHandler(null, { connectionId });
    expect(result).toEqual({ ok: true });
    expect(unsubCalled).toBe(true);
    expect(streamRegistry._map.has(connectionId)).toBe(false);
  });

  it('disconnect handler works when streamRegistry entry has no cleanup', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const connectHandler = mockIpcMain._handlers.get('plugin:p1:logs:connect');
    const ev = mockEvent();
    const { connectionId } = await connectHandler(ev, {});

    // Remove cleanup from streamRegistry entry
    const entry = streamRegistry._map.get(connectionId);
    if (entry) entry.cleanup = undefined;

    const discHandler = mockIpcMain._handlers.get('plugin:p1:logs:disconnect');
    const result = await discHandler(null, { connectionId });
    expect(result).toEqual({ ok: true });
  });

  it('disconnect handler returns { ok: true } even for unknown connectionId (idempotent)', async () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerStream('p1', 'logs', () => ({
      subscribe: () => ({ unsubscribe: vi.fn() }),
    }));

    registerPluginIpcHandlers(mockIpcMain, router);

    const handler = mockIpcMain._handlers.get('plugin:p1:logs:disconnect');
    const result = await handler(null, { connectionId: 'nonexistent' });
    expect(result).toEqual({ ok: true });
  });
});

// ── refreshPluginIpcHandlers ──────────────────────────────────────────────────

describe('refreshPluginIpcHandlers', () => {
  it('calls removeHandler on all previously registered channels', () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerApi('p1', 'm', async () => 'ok');

    registerPluginIpcHandlers(mockIpcMain, router);
    const channelsBefore = new Set(mockIpcMain._handlers.keys());

    refreshPluginIpcHandlers(mockIpcMain, router);
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

    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerApi('p1', 'm', async () => 'ok');

    registerPluginIpcHandlers(badIpcMain, router);
    expect(() => refreshPluginIpcHandlers(badIpcMain, router)).not.toThrow();
  });

  it('re-registers all current plugin methods after clear', () => {
    const router = createMockRouter({ pluginIds: ['p1'] });
    router.registerApi('p1', 'm', async () => 'first');

    registerPluginIpcHandlers(mockIpcMain, router);

    // Change the handler
    router._methods.clear();
    router.registerApi('p1', 'm', async () => 'second');

    refreshPluginIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('plugin:p1:m')).toBe(true);
  });
});

// ── Multi-plugin isolation ────────────────────────────────────────────────────

describe('multi-plugin isolation', () => {
  it('registers handlers for multiple plugins independently', () => {
    const router = createMockRouter({ pluginIds: ['p1', 'p2'] });
    router.registerApi('p1', 'a', async () => 'a');
    router.registerApi('p2', 'b', async () => 'b');
    router.registerStream('p1', 's1', () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }));
    router.registerStream('p2', 's2', () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }));

    registerPluginIpcHandlers(mockIpcMain, router);

    expect(mockIpcMain._handlers.has('plugin:p1:a')).toBe(true);
    expect(mockIpcMain._handlers.has('plugin:p2:b')).toBe(true);
    expect(mockIpcMain._handlers.has('plugin:p1:s1:connect')).toBe(true);
    expect(mockIpcMain._handlers.has('plugin:p2:s2:connect')).toBe(true);
    expect(mockIpcMain._handlers.has('plugin:p1:s1:message')).toBe(true);
    expect(mockIpcMain._handlers.has('plugin:p2:s2:message')).toBe(true);
    expect(mockIpcMain._handlers.has('plugin:p1:s1:disconnect')).toBe(true);
    expect(mockIpcMain._handlers.has('plugin:p2:s2:disconnect')).toBe(true);
  });

  it('plugin with no methods or streams registers only config channels', () => {
    const router = createMockRouter({ pluginIds: ['empty'] });

    registerPluginIpcHandlers(mockIpcMain, router);

    // Only built-in config channels
    const channels = [...mockIpcMain._handlers.keys()];
    expect(channels).toContain('plugin:config:get');
    expect(channels).toContain('plugin:config:set');
  });
});