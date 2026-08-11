/**
 * Tests for backend/lib/app-host.js — createAppHost
 *
 * Covers:
 *   defineApi — delegates to router.registerApi
 *   defineStream — delegates to router.registerStream
 *   getAppDataDir — returns scoped data directory
 *   Error handling — invalid arguments don't throw
 *   Sandbox isolation — host is the only bridge to the system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// ── Mock router ───────────────────────────────────────────────────────────────

const mockRouter = {
  registerApi: vi.fn(),
  registerStream: vi.fn(),
  unregisterApp: vi.fn(),
};

import { createAppHost } from '../lib/app-host.js';
import { appRouter } from '../lib/app-router.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

/** @type {string} */
let tmpDataDir;
/** @type {string} */
let tmpAppsDir;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDataDir = join(tmpdir(), `app-host-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpAppsDir = join(tmpdir(), `app-host-apps-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDataDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDataDir, { recursive: true, force: true }); } catch {}
  try { rmSync(tmpAppsDir, { recursive: true, force: true }); } catch {}
});

// ── Manifest fixture ──────────────────────────────────────────────────────────

const manifest = {
  name: 'test-app',
  version: '0.1.0',
  description: 'A test app',
};

// ── defineApi ─────────────────────────────────────────────────────────────────

describe('defineApi', () => {
  it('registers an API method via the router', () => {
    const host = createAppHost('test-app', manifest, mockRouter, tmpAppsDir, tmpDataDir);
    const handler = vi.fn();
    host.defineApi('greet', handler);

    expect(mockRouter.registerApi).toHaveBeenCalledWith('test-app', 'greet', handler);
  });

  it('does not throw when handler is missing (logs error)', () => {
    const host = createAppHost('test-app', manifest, mockRouter, tmpAppsDir, tmpDataDir);
    expect(() => host.defineApi('greet', null)).not.toThrow();
    expect(mockRouter.registerApi).not.toHaveBeenCalled();
  });

  it('does not throw when method name is not a string', () => {
    const host = createAppHost('test-app', manifest, mockRouter, tmpAppsDir, tmpDataDir);
    expect(() => host.defineApi(123, vi.fn())).not.toThrow();
    expect(mockRouter.registerApi).not.toHaveBeenCalled();
  });
});

// ── defineStream ──────────────────────────────────────────────────────────────

describe('defineStream', () => {
  it('registers a stream handler via the router', () => {
    const host = createAppHost('test-app', manifest, mockRouter, tmpAppsDir, tmpDataDir);
    const handler = vi.fn();
    host.defineStream('logs', handler);

    expect(mockRouter.registerStream).toHaveBeenCalledWith('test-app', 'logs', handler);
  });

  it('does not throw when handler is missing', () => {
    const host = createAppHost('test-app', manifest, mockRouter, tmpAppsDir, tmpDataDir);
    expect(() => host.defineStream('logs', null)).not.toThrow();
    expect(mockRouter.registerStream).not.toHaveBeenCalled();
  });

  it('does not throw when name is not a string', () => {
    const host = createAppHost('test-app', manifest, mockRouter, tmpAppsDir, tmpDataDir);
    expect(() => host.defineStream(42, vi.fn())).not.toThrow();
    expect(mockRouter.registerStream).not.toHaveBeenCalled();
  });
});

// ── getAppDataDir ──────────────────────────────────────────────────────────

describe('getAppDataDir', () => {
  it('returns a path scoped to the app name', () => {
    const host = createAppHost('my-app', manifest, mockRouter, tmpAppsDir, tmpDataDir);
    const dir = host.getAppDataDir();

    expect(dir).toBe(join(tmpDataDir, 'app-data', 'my-app'));
  });

  it('creates the data directory on instantiation', () => {
    createAppHost('new-app', manifest, mockRouter, tmpAppsDir, tmpDataDir);

    const dir = join(tmpDataDir, 'app-data', 'new-app');
    expect(existsSync(dir)).toBe(true);
  });

  it('returns a writable directory', () => {
    const host = createAppHost('write-test', manifest, mockRouter, tmpAppsDir, tmpDataDir);
    const testFile = join(host.getAppDataDir(), 'test.txt');
    writeFileSync(testFile, 'hello');
    expect(existsSync(testFile)).toBe(true);
  });

  it('each app gets its own isolated directory', () => {
    const host1 = createAppHost('app-a', manifest, mockRouter, tmpAppsDir, tmpDataDir);
    const host2 = createAppHost('app-b', manifest, mockRouter, tmpAppsDir, tmpDataDir);

    expect(host1.getAppDataDir()).not.toBe(host2.getAppDataDir());
    expect(host1.getAppDataDir()).toContain('app-a');
    expect(host2.getAppDataDir()).toContain('app-b');
  });
});

// ── Integration: defineApi + defineStream with real router ────────────────────

describe('integration with real router', () => {
  it('defineApi makes methods callable via the router', async () => {
    // Use fresh real router
    appRouter.clear();

    const host = createAppHost('integ-test', manifest, appRouter, tmpAppsDir, tmpDataDir);
    host.defineApi('hello', async (params) => ({ msg: `Hello ${params.name}` }));

    const match = appRouter.matchHttpRoute('/api/app/integ-test/hello');
    expect(match).not.toBe(false);
    const result = await match.handler({ name: 'World' });
    expect(result).toEqual({ msg: 'Hello World' });
  });

  it('defineStream makes handlers available via the router', async () => {
    appRouter.clear();

    const handler = vi.fn();
    const host = createAppHost('integ-test', manifest, appRouter, tmpAppsDir, tmpDataDir);
    host.defineStream('events', handler);

    const match = appRouter.matchWsPath('/api/app/integ-test/events');
    expect(match).not.toBe(false);
    expect(match.handler).toBe(handler);
  });
});
