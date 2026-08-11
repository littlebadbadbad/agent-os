/**
 * Tests for backend/lib/app-router.js — AppRouter
 *
 * Covers:
 *   registerApi / registerStream — registration and idempotency
 *   matchHttpRoute — matching POST /api/app/<id>/<method>
 *   matchIpcChannel — matching app:<id>:<method>
 *   matchWsPath — matching /api/app/<id>/<stream>
 *   unregisterApp — bulk cleanup
 *   getRegisteredApps / getAppMethods / getAppStreams
 *   clear — test cleanup
 *   Multiple app isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

import { appRouter } from '../lib/app-router.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  appRouter.clear();
});

// ── registerApi ───────────────────────────────────────────────────────────────

describe('registerApi', () => {
  it('registers an API method and makes it matchable via HTTP', () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    appRouter.registerApi('test-app', 'greet', handler);

    const match = appRouter.matchHttpRoute('/api/app/test-app/greet');
    expect(match).not.toBe(false);
    expect(match.appId).toBe('test-app');
    expect(match.method).toBe('greet');
    expect(match.handler).toBe(handler);
  });

  it('registers an API method matchable via IPC channel', () => {
    const handler = vi.fn().mockResolvedValue(42);
    appRouter.registerApi('my-app', 'add', handler);

    const match = appRouter.matchIpcChannel('app:my-app:add');
    expect(match).not.toBe(false);
    expect(match.appId).toBe('my-app');
    expect(match.method).toBe('add');
    expect(match.handler).toBe(handler);
  });

  it('handles URL-encoded app names and methods in HTTP', () => {
    const handler = vi.fn().mockResolvedValue(null);
    appRouter.registerApi('my app', 'do thing', handler);

    const match = appRouter.matchHttpRoute('/api/app/my%20app/do%20thing');
    expect(match).not.toBe(false);
    expect(match.appId).toBe('my app');
    expect(match.method).toBe('do thing');
  });

  it('overwrites a previously registered method with a warning', () => {
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    appRouter.registerApi('p', 'm', oldHandler);
    appRouter.registerApi('p', 'm', newHandler);

    const match = appRouter.matchHttpRoute('/api/app/p/m');
    expect(match.handler).toBe(newHandler);
  });

  it('does not mix methods across apps', () => {
    appRouter.registerApi('p1', 'get', vi.fn());
    appRouter.registerApi('p2', 'get', vi.fn());

    const match1 = appRouter.matchHttpRoute('/api/app/p1/get');
    expect(match1).not.toBe(false);
    const match2 = appRouter.matchHttpRoute('/api/app/p2/get');
    expect(match2).not.toBe(false);
    expect(match1.handler).not.toBe(match2.handler);
  });
});

// ── registerStream ────────────────────────────────────────────────────────────

describe('registerStream', () => {
  it('registers a stream handler and makes it matchable via WS path', () => {
    const handler = vi.fn();
    appRouter.registerStream('test-app', 'logs', handler);

    const match = appRouter.matchWsPath('/api/app/test-app/logs');
    expect(match).not.toBe(false);
    expect(match.appId).toBe('test-app');
    expect(match.streamName).toBe('logs');
    expect(match.handler).toBe(handler);
  });

  it('handles URL-encoded stream names in WS path', () => {
    const handler = vi.fn();
    appRouter.registerStream('p', 'my stream', handler);

    const match = appRouter.matchWsPath('/api/app/p/my%20stream');
    expect(match).not.toBe(false);
    expect(match.streamName).toBe('my stream');
  });
});

// ── matchHttpRoute ────────────────────────────────────────────────────────────

describe('matchHttpRoute', () => {
  it('returns false for a non-app path', () => {
    expect(appRouter.matchHttpRoute('/api/health')).toBe(false);
    expect(appRouter.matchHttpRoute('/api/chat')).toBe(false);
    expect(appRouter.matchHttpRoute('/')).toBe(false);
  });

  it('returns false for a app path with no registered method', () => {
    expect(appRouter.matchHttpRoute('/api/app/unknown/method')).toBe(false);
  });

  it('returns false for a path with extra segments', () => {
    appRouter.registerApi('p', 'm', vi.fn());
    expect(appRouter.matchHttpRoute('/api/app/p/m/extra')).toBe(false);
  });

  it('returns false for a path with too few segments', () => {
    expect(appRouter.matchHttpRoute('/api/app/p')).toBe(false);
  });
});

// ── matchIpcChannel ───────────────────────────────────────────────────────────

describe('matchIpcChannel', () => {
  it('returns false for a non-app channel', () => {
    expect(appRouter.matchIpcChannel('api:health')).toBe(false);
    expect(appRouter.matchIpcChannel('browser:list')).toBe(false);
    expect(appRouter.matchIpcChannel('random')).toBe(false);
  });

  it('returns false for an unknown app method channel', () => {
    expect(appRouter.matchIpcChannel('app:unknown:method')).toBe(false);
  });

  it('returns false for malformed channel strings', () => {
    expect(appRouter.matchIpcChannel('app:')).toBe(false);
    expect(appRouter.matchIpcChannel('app:name')).toBe(false);
    expect(appRouter.matchIpcChannel('')).toBe(false);
  });
});

// ── matchWsPath ───────────────────────────────────────────────────────────────

describe('matchWsPath', () => {
  it('returns false for a non-app WS path', () => {
    expect(appRouter.matchWsPath('/api/browser/session/stream')).toBe(false);
    expect(appRouter.matchWsPath('/ws')).toBe(false);
  });

  it('returns false for an unknown stream', () => {
    expect(appRouter.matchWsPath('/api/app/unknown/stream')).toBe(false);
  });
});

// ── unregisterApp ──────────────────────────────────────────────────────────

describe('unregisterApp', () => {
  it('removes all methods and streams for a app', () => {
    appRouter.registerApi('p', 'm1', vi.fn());
    appRouter.registerApi('p', 'm2', vi.fn());
    appRouter.registerStream('p', 's1', vi.fn());

    appRouter.unregisterApp('p');

    expect(appRouter.matchHttpRoute('/api/app/p/m1')).toBe(false);
    expect(appRouter.matchHttpRoute('/api/app/p/m2')).toBe(false);
    expect(appRouter.matchWsPath('/api/app/p/s1')).toBe(false);
    expect(appRouter.getRegisteredApps()).not.toContain('p');
  });

  it('does not affect other apps', () => {
    appRouter.registerApi('p1', 'm', vi.fn());
    appRouter.registerApi('p2', 'm', vi.fn());

    appRouter.unregisterApp('p1');

    expect(appRouter.matchHttpRoute('/api/app/p1/m')).toBe(false);
    expect(appRouter.matchHttpRoute('/api/app/p2/m')).not.toBe(false);
  });

  it('is a no-op for an unknown app', () => {
    expect(() => appRouter.unregisterApp('ghost')).not.toThrow();
  });
});

// ── Introspection ─────────────────────────────────────────────────────────────

describe('introspection', () => {
  it('getRegisteredApps returns all app ids', () => {
    appRouter.registerApi('p1', 'm', vi.fn());
    appRouter.registerApi('p2', 'm', vi.fn());

    const names = appRouter.getRegisteredApps();
    expect(names).toContain('p1');
    expect(names).toContain('p2');
    expect(names).toHaveLength(2);
  });

  it('getAppMethods returns method names for a app', () => {
    appRouter.registerApi('p', 'a', vi.fn());
    appRouter.registerApi('p', 'b', vi.fn());

    const methods = appRouter.getAppMethods('p');
    expect(methods).toContain('a');
    expect(methods).toContain('b');
    expect(methods).toHaveLength(2);
  });

  it('getAppMethods returns empty array for unknown app', () => {
    expect(appRouter.getAppMethods('ghost')).toEqual([]);
  });

  it('getAppStreams returns stream names for a app', () => {
    appRouter.registerStream('p', 's1', vi.fn());
    appRouter.registerStream('p', 's2', vi.fn());

    const streams = appRouter.getAppStreams('p');
    expect(streams).toContain('s1');
    expect(streams).toContain('s2');
  });

  it('getApiMethod returns a registered handler', () => {
    const handler = vi.fn();
    appRouter.registerApi('p', 'm', handler);
    expect(appRouter.getApiMethod('p', 'm')).toBe(handler);
  });

  it('getApiMethod returns undefined for unknown method', () => {
    expect(appRouter.getApiMethod('p', 'unknown')).toBeUndefined();
  });

  it('getStreamHandler returns a registered handler', () => {
    const handler = vi.fn();
    appRouter.registerStream('p', 's', handler);
    expect(appRouter.getStreamHandler('p', 's')).toBe(handler);
  });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('removes all registrations', () => {
    appRouter.registerApi('p1', 'm', vi.fn());
    appRouter.registerApi('p2', 'm', vi.fn());

    appRouter.clear();

    expect(appRouter.getRegisteredApps()).toEqual([]);
    expect(appRouter.matchHttpRoute('/api/app/p1/m')).toBe(false);
  });
});
