/**
 * Tests for backend/lib/plugin-router.js — PluginRouter
 *
 * Covers:
 *   registerApi / registerStream — registration and idempotency
 *   matchHttpRoute — matching POST /api/plugin/<id>/<method>
 *   matchIpcChannel — matching plugin:<id>:<method>
 *   matchWsPath — matching /api/plugin/<id>/<stream>
 *   unregisterPlugin — bulk cleanup
 *   getRegisteredPlugins / getPluginMethods / getPluginStreams
 *   clear — test cleanup
 *   Multiple plugin isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

import { pluginRouter } from '../lib/plugin-router.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  pluginRouter.clear();
});

// ── registerApi ───────────────────────────────────────────────────────────────

describe('registerApi', () => {
  it('registers an API method and makes it matchable via HTTP', () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    pluginRouter.registerApi('test-plugin', 'greet', handler);

    const match = pluginRouter.matchHttpRoute('/api/plugin/test-plugin/greet');
    expect(match).not.toBe(false);
    expect(match.pluginId).toBe('test-plugin');
    expect(match.method).toBe('greet');
    expect(match.handler).toBe(handler);
  });

  it('registers an API method matchable via IPC channel', () => {
    const handler = vi.fn().mockResolvedValue(42);
    pluginRouter.registerApi('my-plugin', 'add', handler);

    const match = pluginRouter.matchIpcChannel('plugin:my-plugin:add');
    expect(match).not.toBe(false);
    expect(match.pluginId).toBe('my-plugin');
    expect(match.method).toBe('add');
    expect(match.handler).toBe(handler);
  });

  it('handles URL-encoded plugin names and methods in HTTP', () => {
    const handler = vi.fn().mockResolvedValue(null);
    pluginRouter.registerApi('my plugin', 'do thing', handler);

    const match = pluginRouter.matchHttpRoute('/api/plugin/my%20plugin/do%20thing');
    expect(match).not.toBe(false);
    expect(match.pluginId).toBe('my plugin');
    expect(match.method).toBe('do thing');
  });

  it('overwrites a previously registered method with a warning', () => {
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    pluginRouter.registerApi('p', 'm', oldHandler);
    pluginRouter.registerApi('p', 'm', newHandler);

    const match = pluginRouter.matchHttpRoute('/api/plugin/p/m');
    expect(match.handler).toBe(newHandler);
  });

  it('does not mix methods across plugins', () => {
    pluginRouter.registerApi('p1', 'get', vi.fn());
    pluginRouter.registerApi('p2', 'get', vi.fn());

    const match1 = pluginRouter.matchHttpRoute('/api/plugin/p1/get');
    expect(match1).not.toBe(false);
    const match2 = pluginRouter.matchHttpRoute('/api/plugin/p2/get');
    expect(match2).not.toBe(false);
    expect(match1.handler).not.toBe(match2.handler);
  });
});

// ── registerStream ────────────────────────────────────────────────────────────

describe('registerStream', () => {
  it('registers a stream handler and makes it matchable via WS path', () => {
    const handler = vi.fn();
    pluginRouter.registerStream('test-plugin', 'logs', handler);

    const match = pluginRouter.matchWsPath('/api/plugin/test-plugin/logs');
    expect(match).not.toBe(false);
    expect(match.pluginId).toBe('test-plugin');
    expect(match.streamName).toBe('logs');
    expect(match.handler).toBe(handler);
  });

  it('handles URL-encoded stream names in WS path', () => {
    const handler = vi.fn();
    pluginRouter.registerStream('p', 'my stream', handler);

    const match = pluginRouter.matchWsPath('/api/plugin/p/my%20stream');
    expect(match).not.toBe(false);
    expect(match.streamName).toBe('my stream');
  });
});

// ── matchHttpRoute ────────────────────────────────────────────────────────────

describe('matchHttpRoute', () => {
  it('returns false for a non-plugin path', () => {
    expect(pluginRouter.matchHttpRoute('/api/health')).toBe(false);
    expect(pluginRouter.matchHttpRoute('/api/chat')).toBe(false);
    expect(pluginRouter.matchHttpRoute('/')).toBe(false);
  });

  it('returns false for a plugin path with no registered method', () => {
    expect(pluginRouter.matchHttpRoute('/api/plugin/unknown/method')).toBe(false);
  });

  it('returns false for a path with extra segments', () => {
    pluginRouter.registerApi('p', 'm', vi.fn());
    expect(pluginRouter.matchHttpRoute('/api/plugin/p/m/extra')).toBe(false);
  });

  it('returns false for a path with too few segments', () => {
    expect(pluginRouter.matchHttpRoute('/api/plugin/p')).toBe(false);
  });
});

// ── matchIpcChannel ───────────────────────────────────────────────────────────

describe('matchIpcChannel', () => {
  it('returns false for a non-plugin channel', () => {
    expect(pluginRouter.matchIpcChannel('api:health')).toBe(false);
    expect(pluginRouter.matchIpcChannel('browser:list')).toBe(false);
    expect(pluginRouter.matchIpcChannel('random')).toBe(false);
  });

  it('returns false for an unknown plugin method channel', () => {
    expect(pluginRouter.matchIpcChannel('plugin:unknown:method')).toBe(false);
  });

  it('returns false for malformed channel strings', () => {
    expect(pluginRouter.matchIpcChannel('plugin:')).toBe(false);
    expect(pluginRouter.matchIpcChannel('plugin:name')).toBe(false);
    expect(pluginRouter.matchIpcChannel('')).toBe(false);
  });
});

// ── matchWsPath ───────────────────────────────────────────────────────────────

describe('matchWsPath', () => {
  it('returns false for a non-plugin WS path', () => {
    expect(pluginRouter.matchWsPath('/api/browser/session/stream')).toBe(false);
    expect(pluginRouter.matchWsPath('/ws')).toBe(false);
  });

  it('returns false for an unknown stream', () => {
    expect(pluginRouter.matchWsPath('/api/plugin/unknown/stream')).toBe(false);
  });
});

// ── unregisterPlugin ──────────────────────────────────────────────────────────

describe('unregisterPlugin', () => {
  it('removes all methods and streams for a plugin', () => {
    pluginRouter.registerApi('p', 'm1', vi.fn());
    pluginRouter.registerApi('p', 'm2', vi.fn());
    pluginRouter.registerStream('p', 's1', vi.fn());

    pluginRouter.unregisterPlugin('p');

    expect(pluginRouter.matchHttpRoute('/api/plugin/p/m1')).toBe(false);
    expect(pluginRouter.matchHttpRoute('/api/plugin/p/m2')).toBe(false);
    expect(pluginRouter.matchWsPath('/api/plugin/p/s1')).toBe(false);
    expect(pluginRouter.getRegisteredPlugins()).not.toContain('p');
  });

  it('does not affect other plugins', () => {
    pluginRouter.registerApi('p1', 'm', vi.fn());
    pluginRouter.registerApi('p2', 'm', vi.fn());

    pluginRouter.unregisterPlugin('p1');

    expect(pluginRouter.matchHttpRoute('/api/plugin/p1/m')).toBe(false);
    expect(pluginRouter.matchHttpRoute('/api/plugin/p2/m')).not.toBe(false);
  });

  it('is a no-op for an unknown plugin', () => {
    expect(() => pluginRouter.unregisterPlugin('ghost')).not.toThrow();
  });
});

// ── Introspection ─────────────────────────────────────────────────────────────

describe('introspection', () => {
  it('getRegisteredPlugins returns all plugin ids', () => {
    pluginRouter.registerApi('p1', 'm', vi.fn());
    pluginRouter.registerApi('p2', 'm', vi.fn());

    const names = pluginRouter.getRegisteredPlugins();
    expect(names).toContain('p1');
    expect(names).toContain('p2');
    expect(names).toHaveLength(2);
  });

  it('getPluginMethods returns method names for a plugin', () => {
    pluginRouter.registerApi('p', 'a', vi.fn());
    pluginRouter.registerApi('p', 'b', vi.fn());

    const methods = pluginRouter.getPluginMethods('p');
    expect(methods).toContain('a');
    expect(methods).toContain('b');
    expect(methods).toHaveLength(2);
  });

  it('getPluginMethods returns empty array for unknown plugin', () => {
    expect(pluginRouter.getPluginMethods('ghost')).toEqual([]);
  });

  it('getPluginStreams returns stream names for a plugin', () => {
    pluginRouter.registerStream('p', 's1', vi.fn());
    pluginRouter.registerStream('p', 's2', vi.fn());

    const streams = pluginRouter.getPluginStreams('p');
    expect(streams).toContain('s1');
    expect(streams).toContain('s2');
  });

  it('getApiMethod returns a registered handler', () => {
    const handler = vi.fn();
    pluginRouter.registerApi('p', 'm', handler);
    expect(pluginRouter.getApiMethod('p', 'm')).toBe(handler);
  });

  it('getApiMethod returns undefined for unknown method', () => {
    expect(pluginRouter.getApiMethod('p', 'unknown')).toBeUndefined();
  });

  it('getStreamHandler returns a registered handler', () => {
    const handler = vi.fn();
    pluginRouter.registerStream('p', 's', handler);
    expect(pluginRouter.getStreamHandler('p', 's')).toBe(handler);
  });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('removes all registrations', () => {
    pluginRouter.registerApi('p1', 'm', vi.fn());
    pluginRouter.registerApi('p2', 'm', vi.fn());

    pluginRouter.clear();

    expect(pluginRouter.getRegisteredPlugins()).toEqual([]);
    expect(pluginRouter.matchHttpRoute('/api/plugin/p1/m')).toBe(false);
  });
});
