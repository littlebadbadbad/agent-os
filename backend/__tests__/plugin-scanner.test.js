/**
 * Tests for backend/lib/plugin-scanner.js — PluginScanner
 *
 * Covers:
 *   scan — finds manifests in plugins/ directory
 *   activate — imports backend entry, calls activate with host
 *   deactivate — unregisters plugin from router
 *   bootstrap — load state → scan → activate cycle
 *   Error isolation — one failing activation doesn't block others
 *   State persistence — disabled flag survives restarts
 *   Missing backend entry — activates without runtime
 *   Nonexistent plugins directory — graceful handling
 *   Invalid manifest — skipped gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Silence logger ────────────────────────────────────────────────────────────

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

import { createPluginScanner } from '../lib/plugin-scanner.js';
import { pluginRouter } from '../lib/plugin-router.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a temporary plugin directory with manifest and optional backend entry. */
function createTestPlugin(baseDir, name, version, opts = {}) {
  const pluginDir = join(baseDir, name);
  mkdirSync(pluginDir, { recursive: true });

  const manifest = {
    id: name,
    name: opts.displayName ?? name,
    version,
    description: opts.description ?? `Plugin ${name}`,
  };
  if (opts.backendEntry) manifest.backendEntry = opts.backendEntry;
  if (opts.agentEntry) manifest.agentEntry = opts.agentEntry;
  if (opts.uiEntry) manifest.uiEntry = opts.uiEntry;
  if (opts.privileged) manifest.privileged = true;

  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  if (opts.backendEntry && opts.backendCode !== undefined) {
    const idx = opts.backendEntry.lastIndexOf('/');
    if (idx > 0) {
      const entryDir = join(pluginDir, opts.backendEntry.substring(0, idx));
      mkdirSync(entryDir, { recursive: true });
    }
    writeFileSync(join(pluginDir, opts.backendEntry), opts.backendCode);
  }

  return manifest;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

/** @type {string} */
let tmpDir;
/** @type {string} */
let pluginsDir;
/** @type {string} */
let dataDir;

beforeEach(() => {
  vi.clearAllMocks();
  pluginRouter.clear();

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tmpDir = join(tmpdir(), `plugin-scanner-test-${id}`);
  pluginsDir = join(tmpDir, 'plugins');
  dataDir = join(tmpDir, 'data');
  mkdirSync(pluginsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ── scan ──────────────────────────────────────────────────────────────────────

describe('scan', () => {
  it('discovers plugins with valid manifests', async () => {
    createTestPlugin(pluginsDir, 'plugin-a', '1.0.0', { description: 'A' });
    createTestPlugin(pluginsDir, 'plugin-b', '2.0.0', { description: 'B' });

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const manifests = await scanner.scan();

    expect(manifests).toHaveLength(2);
    expect(manifests.find((m) => m.id === 'plugin-a').version).toBe('1.0.0');
    expect(manifests.find((m) => m.id === 'plugin-b').version).toBe('2.0.0');
  });

  it('returns empty array when plugins directory does not exist', async () => {
    const scanner = createPluginScanner(pluginRouter, '/nonexistent/path', dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });

  it('skips directories without manifest.json', async () => {
    mkdirSync(join(pluginsDir, 'no-manifest'), { recursive: true });
    createTestPlugin(pluginsDir, 'has-manifest', '1.0.0');

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toHaveLength(1);
    expect(manifests[0].id).toBe('has-manifest');
  });

  it('skips hidden directories', async () => {
    createTestPlugin(pluginsDir, '.hidden', '1.0.0');
    createTestPlugin(pluginsDir, 'visible', '1.0.0');

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toHaveLength(1);
    expect(manifests[0].id).toBe('visible');
  });

  it('skips manifests with missing id field', async () => {
    const pluginDir = join(pluginsDir, 'bad-plugin');
    mkdirSync(pluginDir);
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({ name: 'bad-plugin', version: '1.0.0' }));

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });

  it('skips manifests with missing name field', async () => {
    const pluginDir = join(pluginsDir, 'bad-plugin');
    mkdirSync(pluginDir);
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({ id: 'bad-plugin', version: '1.0.0' }));

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });

  it('skips manifests with missing version field', async () => {
    const pluginDir = join(pluginsDir, 'bad-plugin');
    mkdirSync(pluginDir);
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({ id: 'bad-plugin', name: 'bad-plugin' }));

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });

  it('skips manifests with invalid JSON', async () => {
    const pluginDir = join(pluginsDir, 'bad-plugin');
    mkdirSync(pluginDir);
    writeFileSync(join(pluginDir, 'manifest.json'), 'not json');

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });
});

// ── activate ──────────────────────────────────────────────────────────────────

describe('activate', () => {
  it('activates a plugin with backend entry', async () => {
    createTestPlugin(pluginsDir, 'my-plugin', '0.1.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("ping", async () => ({ pong: true })); }',
    });

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const ok = await scanner.activate('my-plugin');

    expect(ok).toBe(true);
    expect(scanner.getState('my-plugin')).toBe('active');
  });

  it('activates a plugin without backend entry', async () => {
    createTestPlugin(pluginsDir, 'ui-only', '1.0.0');

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const ok = await scanner.activate('ui-only');

    expect(ok).toBe(true);
    expect(scanner.getState('ui-only')).toBe('active');
  });

  it('returns false for unknown plugin', async () => {
    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const ok = await scanner.activate('ghost');
    expect(ok).toBe(false);
  });

  it('returns false when backend entry file is missing', async () => {
    // Create manifest but DON'T write the backend entry file.
    const pluginDir = join(pluginsDir, 'broken');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({
      id: 'broken', name: 'broken', version: '1.0.0', backendEntry: 'backend/missing.js',
    }, null, 2));

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const ok = await scanner.activate('broken');
    expect(ok).toBe(false);
    expect(scanner.getState('broken')).toBe('error');
  });
});

// ── Error isolation (R1) ──────────────────────────────────────────────────────

describe('error isolation', () => {
  it('one failing activation does not prevent others from loading', async () => {
    // Plugin A — will fail (missing backend entry file)
    const pDir = join(pluginsDir, 'plugin-a');
    mkdirSync(pDir, { recursive: true });
    writeFileSync(join(pDir, 'manifest.json'), JSON.stringify({
      id: 'plugin-a', name: 'plugin-a', version: '1.0.0', backendEntry: 'backend/missing.js',
    }, null, 2));

    // Plugin B — valid
    createTestPlugin(pluginsDir, 'plugin-b', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("ok", async () => ({})); }',
    });

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await scanner.bootstrap();

    // Plugin A should be in error state.
    expect(scanner.getState('plugin-a')).toBe('error');
    // Plugin B should be active.
    expect(scanner.getState('plugin-b')).toBe('active');
  });

  it('exception in activate function does not crash the scanner', async () => {
    createTestPlugin(pluginsDir, 'throws', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { throw new Error("init failed"); }',
    });

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const ok = await scanner.activate('throws');

    expect(ok).toBe(false);
    expect(scanner.getState('throws')).toBe('error');
  });

  it('exception during dynamic import does not crash other plugins', async () => {
    createTestPlugin(pluginsDir, 'corrupt', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("bad", async () => ({})); } export {',
      // Intentional syntax error
    });
    createTestPlugin(pluginsDir, 'good', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("ok", async () => ({})); }',
    });

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await scanner.bootstrap();

    expect(scanner.getState('corrupt')).toBe('error');
    expect(scanner.getState('good')).toBe('active');
  });
});

// ── deactivate ────────────────────────────────────────────────────────────────

describe('deactivate', () => {
  it('unregisters plugin routes from the router', async () => {
    createTestPlugin(pluginsDir, 'my-plugin', '0.1.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("ping", async () => ({ pong: true })); }',
    });

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await scanner.activate('my-plugin');

    // Verify route exists.
    expect(pluginRouter.matchHttpRoute('/api/plugin/my-plugin/ping')).not.toBe(false);

    // Deactivate.
    const ok = await scanner.deactivate('my-plugin');
    expect(ok).toBe(true);

    // Route should be gone.
    expect(pluginRouter.matchHttpRoute('/api/plugin/my-plugin/ping')).toBe(false);
    expect(scanner.getState('my-plugin')).toBe('inactive');
  });

  it('returns false for unknown plugin', async () => {
    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    const ok = await scanner.deactivate('ghost');
    expect(ok).toBe(false);
  });
});

// ── bootstrap ─────────────────────────────────────────────────────────────────

describe('bootstrap', () => {
  it('loads state, scans, and activates enabled plugins', async () => {
    createTestPlugin(pluginsDir, 'p1', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("a", async () => ({})); }',
    });
    createTestPlugin(pluginsDir, 'p2', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("b", async () => ({})); }',
    });

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await scanner.bootstrap();

    expect(scanner.getState('p1')).toBe('active');
    expect(scanner.getState('p2')).toBe('active');
  });

  it('respects persisted disabled state', async () => {
    createTestPlugin(pluginsDir, 'enabled-plugin', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("a", async () => ({})); }',
    });
    createTestPlugin(pluginsDir, 'disabled-plugin', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("b", async () => ({})); }',
    });

    // Pre-write state: disabled-plugin is disabled.
    const stateFile = join(dataDir, 'plugin-state.json');
    writeFileSync(stateFile, JSON.stringify({ 'disabled-plugin': 'disabled' }, null, 2));

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await scanner.bootstrap();

    expect(scanner.getState('enabled-plugin')).toBe('active');
    expect(scanner.getState('disabled-plugin')).toBe('disabled');
  });

  it('handles empty plugins directory gracefully', async () => {
    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await expect(scanner.bootstrap()).resolves.toBeUndefined();
  });

  it('handles nonexistent plugins directory gracefully', async () => {
    const scanner = createPluginScanner(pluginRouter, '/nonexistent', dataDir);
    await expect(scanner.bootstrap()).resolves.toBeUndefined();
  });
});

// ── State persistence ─────────────────────────────────────────────────────────

describe('state persistence', () => {
  it('getState returns inactive for unknown plugin', () => {
    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    expect(scanner.getState('ghost')).toBe('inactive');
  });

  it('enable removes disabled state and activates plugin', async () => {
    createTestPlugin(pluginsDir, 'enable-test', '1.0.0');
    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await scanner.bootstrap();

    // Disable the plugin first
    await scanner.disable('enable-test');
    expect(scanner.getState('enable-test')).toBe('disabled');

    // Enable it
    const result = await scanner.enable('enable-test');
    expect(result.ok).toBe(true);
    expect(scanner.getState('enable-test')).toBe('active');
  });

  it('disable blocks self-disable of plugin-manager', async () => {
    createTestPlugin(pluginsDir, 'plugin-manager', '1.0.0');
    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await scanner.bootstrap();

    const result = await scanner.disable('plugin-manager');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── Introspection ─────────────────────────────────────────────────────────────

describe('introspection', () => {
  it('getActivePlugins returns all tracked plugins', async () => {
    createTestPlugin(pluginsDir, 'p1', '1.0.0');
    createTestPlugin(pluginsDir, 'p2', '1.0.0');

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await scanner.bootstrap();

    const plugins = scanner.getActivePlugins();
    expect(plugins).toHaveLength(2);
    expect(plugins.find((p) => p.manifest.id === 'p1').state).toBe('active');
    expect(plugins.find((p) => p.manifest.id === 'p2').state).toBe('active');
  });

  it('getPluginManifest returns parsed manifest', async () => {
    createTestPlugin(pluginsDir, 'my-plugin', '0.5.0', { description: 'My plugin' });

    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    await scanner.bootstrap();

    const manifest = scanner.getPluginManifest('my-plugin');
    expect(manifest.id).toBe('my-plugin');
    expect(manifest.version).toBe('0.5.0');
    expect(manifest.description).toBe('My plugin');
  });

  it('getPluginManifest returns undefined for unknown plugin', () => {
    const scanner = createPluginScanner(pluginRouter, pluginsDir, dataDir);
    expect(scanner.getPluginManifest('ghost')).toBeUndefined();
  });
});
