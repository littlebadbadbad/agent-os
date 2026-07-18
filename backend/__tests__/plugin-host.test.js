/**
 * Tests for backend/lib/plugin-host.js — createPluginHost
 *
 * Covers:
 *   defineApi — delegates to router.registerApi
 *   defineStream — delegates to router.registerStream
 *   getPluginDataDir — returns scoped data directory
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
  unregisterPlugin: vi.fn(),
};

import { createPluginHost } from '../lib/plugin-host.js';
import { pluginRouter } from '../lib/plugin-router.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

/** @type {string} */
let tmpDataDir;
/** @type {string} */
let tmpPluginsDir;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDataDir = join(tmpdir(), `plugin-host-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpPluginsDir = join(tmpdir(), `plugin-host-plugins-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDataDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDataDir, { recursive: true, force: true }); } catch {}
  try { rmSync(tmpPluginsDir, { recursive: true, force: true }); } catch {}
});

// ── Manifest fixture ──────────────────────────────────────────────────────────

const manifest = {
  name: 'test-plugin',
  version: '0.1.0',
  description: 'A test plugin',
};

// ── defineApi ─────────────────────────────────────────────────────────────────

describe('defineApi', () => {
  it('registers an API method via the router', () => {
    const host = createPluginHost('test-plugin', manifest, mockRouter, tmpPluginsDir, tmpDataDir);
    const handler = vi.fn();
    host.defineApi('greet', handler);

    expect(mockRouter.registerApi).toHaveBeenCalledWith('test-plugin', 'greet', handler);
  });

  it('does not throw when handler is missing (logs error)', () => {
    const host = createPluginHost('test-plugin', manifest, mockRouter, tmpPluginsDir, tmpDataDir);
    expect(() => host.defineApi('greet', null)).not.toThrow();
    expect(mockRouter.registerApi).not.toHaveBeenCalled();
  });

  it('does not throw when method name is not a string', () => {
    const host = createPluginHost('test-plugin', manifest, mockRouter, tmpPluginsDir, tmpDataDir);
    expect(() => host.defineApi(123, vi.fn())).not.toThrow();
    expect(mockRouter.registerApi).not.toHaveBeenCalled();
  });
});

// ── defineStream ──────────────────────────────────────────────────────────────

describe('defineStream', () => {
  it('registers a stream handler via the router', () => {
    const host = createPluginHost('test-plugin', manifest, mockRouter, tmpPluginsDir, tmpDataDir);
    const handler = vi.fn();
    host.defineStream('logs', handler);

    expect(mockRouter.registerStream).toHaveBeenCalledWith('test-plugin', 'logs', handler);
  });

  it('does not throw when handler is missing', () => {
    const host = createPluginHost('test-plugin', manifest, mockRouter, tmpPluginsDir, tmpDataDir);
    expect(() => host.defineStream('logs', null)).not.toThrow();
    expect(mockRouter.registerStream).not.toHaveBeenCalled();
  });

  it('does not throw when name is not a string', () => {
    const host = createPluginHost('test-plugin', manifest, mockRouter, tmpPluginsDir, tmpDataDir);
    expect(() => host.defineStream(42, vi.fn())).not.toThrow();
    expect(mockRouter.registerStream).not.toHaveBeenCalled();
  });
});

// ── getPluginDataDir ──────────────────────────────────────────────────────────

describe('getPluginDataDir', () => {
  it('returns a path scoped to the plugin name', () => {
    const host = createPluginHost('my-plugin', manifest, mockRouter, tmpPluginsDir, tmpDataDir);
    const dir = host.getPluginDataDir();

    expect(dir).toBe(join(tmpDataDir, 'plugin-data', 'my-plugin'));
  });

  it('creates the data directory on instantiation', () => {
    createPluginHost('new-plugin', manifest, mockRouter, tmpPluginsDir, tmpDataDir);

    const dir = join(tmpDataDir, 'plugin-data', 'new-plugin');
    expect(existsSync(dir)).toBe(true);
  });

  it('returns a writable directory', () => {
    const host = createPluginHost('write-test', manifest, mockRouter, tmpPluginsDir, tmpDataDir);
    const testFile = join(host.getPluginDataDir(), 'test.txt');
    writeFileSync(testFile, 'hello');
    expect(existsSync(testFile)).toBe(true);
  });

  it('each plugin gets its own isolated directory', () => {
    const host1 = createPluginHost('plugin-a', manifest, mockRouter, tmpPluginsDir, tmpDataDir);
    const host2 = createPluginHost('plugin-b', manifest, mockRouter, tmpPluginsDir, tmpDataDir);

    expect(host1.getPluginDataDir()).not.toBe(host2.getPluginDataDir());
    expect(host1.getPluginDataDir()).toContain('plugin-a');
    expect(host2.getPluginDataDir()).toContain('plugin-b');
  });
});

// ── Integration: defineApi + defineStream with real router ────────────────────

describe('integration with real router', () => {
  it('defineApi makes methods callable via the router', async () => {
    // Use fresh real router
    pluginRouter.clear();

    const host = createPluginHost('integ-test', manifest, pluginRouter, tmpPluginsDir, tmpDataDir);
    host.defineApi('hello', async (params) => ({ msg: `Hello ${params.name}` }));

    const match = pluginRouter.matchHttpRoute('/api/plugin/integ-test/hello');
    expect(match).not.toBe(false);
    const result = await match.handler({ name: 'World' });
    expect(result).toEqual({ msg: 'Hello World' });
  });

  it('defineStream makes handlers available via the router', async () => {
    pluginRouter.clear();

    const handler = vi.fn();
    const host = createPluginHost('integ-test', manifest, pluginRouter, tmpPluginsDir, tmpDataDir);
    host.defineStream('events', handler);

    const match = pluginRouter.matchWsPath('/api/plugin/integ-test/events');
    expect(match).not.toBe(false);
    expect(match.handler).toBe(handler);
  });
});
