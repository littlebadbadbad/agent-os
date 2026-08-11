/**
 * Tests for backend/lib/app-scanner.js — AppScanner
 *
 * Covers:
 *   scan — finds manifests in apps/ directory
 *   activate — imports backend entry, calls activate with host
 *   deactivate — unregisters app from router
 *   bootstrap — load state → scan → activate cycle
 *   Error isolation — one failing activation doesn't block others
 *   State persistence — disabled flag survives restarts
 *   Missing backend entry — activates without runtime
 *   Nonexistent apps directory — graceful handling
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

import { createAppScanner } from '../lib/app-scanner.js';
import { appRouter } from '../lib/app-router.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a temporary app directory with manifest and optional backend entry. */
function createTestApp(baseDir, name, version, opts = {}) {
  const appDir = join(baseDir, name);
  mkdirSync(appDir, { recursive: true });

  const manifest = {
    id: name,
    name: opts.displayName ?? name,
    version,
    description: opts.description ?? `App ${name}`,
  };
  if (opts.backendEntry) manifest.backendEntry = opts.backendEntry;
  if (opts.agentEntry) manifest.agentEntry = opts.agentEntry;
  if (opts.uiEntry) manifest.uiEntry = opts.uiEntry;
  if (opts.privileged) manifest.privileged = true;

  writeFileSync(join(appDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  if (opts.backendEntry && opts.backendCode !== undefined) {
    const idx = opts.backendEntry.lastIndexOf('/');
    if (idx > 0) {
      const entryDir = join(appDir, opts.backendEntry.substring(0, idx));
      mkdirSync(entryDir, { recursive: true });
    }
    writeFileSync(join(appDir, opts.backendEntry), opts.backendCode);
  }

  return manifest;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

/** @type {string} */
let tmpDir;
/** @type {string} */
let appsDir;
/** @type {string} */
let dataDir;

beforeEach(() => {
  vi.clearAllMocks();
  appRouter.clear();

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tmpDir = join(tmpdir(), `app-scanner-test-${id}`);
  appsDir = join(tmpDir, 'apps');
  dataDir = join(tmpDir, 'data');
  mkdirSync(appsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ── scan ──────────────────────────────────────────────────────────────────────

describe('scan', () => {
  it('discovers apps with valid manifests', async () => {
    createTestApp(appsDir, 'app-a', '1.0.0', { description: 'A' });
    createTestApp(appsDir, 'app-b', '2.0.0', { description: 'B' });

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const manifests = await scanner.scan();

    expect(manifests).toHaveLength(2);
    expect(manifests.find((m) => m.id === 'app-a').version).toBe('1.0.0');
    expect(manifests.find((m) => m.id === 'app-b').version).toBe('2.0.0');
  });

  it('returns empty array when apps directory does not exist', async () => {
    const scanner = createAppScanner(appRouter, '/nonexistent/path', dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });

  it('skips directories without manifest.json', async () => {
    mkdirSync(join(appsDir, 'no-manifest'), { recursive: true });
    createTestApp(appsDir, 'has-manifest', '1.0.0');

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toHaveLength(1);
    expect(manifests[0].id).toBe('has-manifest');
  });

  it('skips hidden directories', async () => {
    createTestApp(appsDir, '.hidden', '1.0.0');
    createTestApp(appsDir, 'visible', '1.0.0');

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toHaveLength(1);
    expect(manifests[0].id).toBe('visible');
  });

  it('skips manifests with missing id field', async () => {
    const appDir = join(appsDir, 'bad-app');
    mkdirSync(appDir);
    writeFileSync(join(appDir, 'manifest.json'), JSON.stringify({ name: 'bad-app', version: '1.0.0' }));

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });

  it('skips manifests with missing name field', async () => {
    const appDir = join(appsDir, 'bad-app');
    mkdirSync(appDir);
    writeFileSync(join(appDir, 'manifest.json'), JSON.stringify({ id: 'bad-app', version: '1.0.0' }));

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });

  it('skips manifests with missing version field', async () => {
    const appDir = join(appsDir, 'bad-app');
    mkdirSync(appDir);
    writeFileSync(join(appDir, 'manifest.json'), JSON.stringify({ id: 'bad-app', name: 'bad-app' }));

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });

  it('skips manifests with invalid JSON', async () => {
    const appDir = join(appsDir, 'bad-app');
    mkdirSync(appDir);
    writeFileSync(join(appDir, 'manifest.json'), 'not json');

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const manifests = await scanner.scan();
    expect(manifests).toEqual([]);
  });

  it('orders by built-in declaration order (dependency order)', async () => {
    // terminal 声明在 dynamic-tool 之前 —— 被依赖者必须先激活。
    createTestApp(appsDir, 'dynamic-tool', '1.0.0');
    createTestApp(appsDir, 'terminal', '1.0.0');
    createTestApp(appsDir, 'zzz-third-party', '1.0.0');

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const manifests = await scanner.scan();

    const ids = manifests.map((m) => m.id);
    // 内置 app 遵循声明顺序（terminal 先于 dynamic-tool）。
    expect(ids.indexOf('terminal')).toBeLessThan(ids.indexOf('dynamic-tool'));
    // 未声明的第三方 app 排在最后。
    expect(ids[ids.length - 1]).toBe('zzz-third-party');
  });
});

// ── activate ──────────────────────────────────────────────────────────────────

describe('activate', () => {
  it('activates a app with backend entry', async () => {
    createTestApp(appsDir, 'my-app', '0.1.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("ping", async () => ({ pong: true })); }',
    });

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const ok = await scanner.activate('my-app');

    expect(ok).toBe(true);
    expect(scanner.getState('my-app')).toBe('active');
  });

  it('activates a app without backend entry', async () => {
    createTestApp(appsDir, 'ui-only', '1.0.0');

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const ok = await scanner.activate('ui-only');

    expect(ok).toBe(true);
    expect(scanner.getState('ui-only')).toBe('active');
  });

  it('returns false for unknown app', async () => {
    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const ok = await scanner.activate('ghost');
    expect(ok).toBe(false);
  });

  it('returns false when backend entry file is missing', async () => {
    // Create manifest but DON'T write the backend entry file.
    const appDir = join(appsDir, 'broken');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'manifest.json'), JSON.stringify({
      id: 'broken', name: 'broken', version: '1.0.0', backendEntry: 'backend/missing.js',
    }, null, 2));

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const ok = await scanner.activate('broken');
    expect(ok).toBe(false);
    expect(scanner.getState('broken')).toBe('error');
  });
});

// ── Error isolation (R1) ──────────────────────────────────────────────────────

describe('error isolation', () => {
  it('one failing activation does not prevent others from loading', async () => {
    // App A — will fail (missing backend entry file)
    const pDir = join(appsDir, 'app-a');
    mkdirSync(pDir, { recursive: true });
    writeFileSync(join(pDir, 'manifest.json'), JSON.stringify({
      id: 'app-a', name: 'app-a', version: '1.0.0', backendEntry: 'backend/missing.js',
    }, null, 2));

    // App B — valid
    createTestApp(appsDir, 'app-b', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("ok", async () => ({})); }',
    });

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    await scanner.bootstrap();

    // App A should be in error state.
    expect(scanner.getState('app-a')).toBe('error');
    // App B should be active.
    expect(scanner.getState('app-b')).toBe('active');
  });

  it('exception in activate function does not crash the scanner', async () => {
    createTestApp(appsDir, 'throws', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { throw new Error("init failed"); }',
    });

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const ok = await scanner.activate('throws');

    expect(ok).toBe(false);
    expect(scanner.getState('throws')).toBe('error');
  });

  it('exception during dynamic import does not crash other apps', async () => {
    createTestApp(appsDir, 'corrupt', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("bad", async () => ({})); } export {',
      // Intentional syntax error
    });
    createTestApp(appsDir, 'good', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("ok", async () => ({})); }',
    });

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    await scanner.bootstrap();

    expect(scanner.getState('corrupt')).toBe('error');
    expect(scanner.getState('good')).toBe('active');
  });
});

// ── deactivate ────────────────────────────────────────────────────────────────

describe('deactivate', () => {
  it('unregisters app routes from the router', async () => {
    createTestApp(appsDir, 'my-app', '0.1.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("ping", async () => ({ pong: true })); }',
    });

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    await scanner.activate('my-app');

    // Verify route exists.
    expect(appRouter.matchHttpRoute('/api/app/my-app/ping')).not.toBe(false);

    // Deactivate.
    const ok = await scanner.deactivate('my-app');
    expect(ok).toBe(true);

    // Route should be gone.
    expect(appRouter.matchHttpRoute('/api/app/my-app/ping')).toBe(false);
    expect(scanner.getState('my-app')).toBe('inactive');
  });

  it('returns false for unknown app', async () => {
    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    const ok = await scanner.deactivate('ghost');
    expect(ok).toBe(false);
  });
});

// ── bootstrap ─────────────────────────────────────────────────────────────────

describe('bootstrap', () => {
  it('loads state, scans, and activates enabled apps', async () => {
    createTestApp(appsDir, 'p1', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("a", async () => ({})); }',
    });
    createTestApp(appsDir, 'p2', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("b", async () => ({})); }',
    });

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    await scanner.bootstrap();

    expect(scanner.getState('p1')).toBe('active');
    expect(scanner.getState('p2')).toBe('active');
  });

  it('respects persisted disabled state', async () => {
    createTestApp(appsDir, 'enabled-app', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("a", async () => ({})); }',
    });
    createTestApp(appsDir, 'disabled-app', '1.0.0', {
      backendEntry: 'backend/index.js',
      backendCode: 'export function activate(host) { host.defineApi("b", async () => ({})); }',
    });

    // Pre-write state: disabled-app is disabled.
    const stateFile = join(dataDir, 'app-state.json');
    writeFileSync(stateFile, JSON.stringify({ 'disabled-app': 'disabled' }, null, 2));

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    await scanner.bootstrap();

    expect(scanner.getState('enabled-app')).toBe('active');
    expect(scanner.getState('disabled-app')).toBe('disabled');
  });

  it('handles empty apps directory gracefully', async () => {
    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    await expect(scanner.bootstrap()).resolves.toBeUndefined();
  });

  it('handles nonexistent apps directory gracefully', async () => {
    const scanner = createAppScanner(appRouter, '/nonexistent', dataDir);
    await expect(scanner.bootstrap()).resolves.toBeUndefined();
  });
});

// ── State persistence ─────────────────────────────────────────────────────────

describe('state persistence', () => {
  it('getState returns inactive for unknown app', () => {
    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    expect(scanner.getState('ghost')).toBe('inactive');
  });

  it('enable removes disabled state and activates app', async () => {
    createTestApp(appsDir, 'enable-test', '1.0.0');
    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    await scanner.bootstrap();

    // Disable the app first
    await scanner.disable('enable-test');
    expect(scanner.getState('enable-test')).toBe('disabled');

    // Enable it
    const result = await scanner.enable('enable-test');
    expect(result.ok).toBe(true);
    expect(scanner.getState('enable-test')).toBe('active');
  });

});

// ── Introspection ─────────────────────────────────────────────────────────────

describe('introspection', () => {
  it('getActiveApps returns all tracked apps', async () => {
    createTestApp(appsDir, 'p1', '1.0.0');
    createTestApp(appsDir, 'p2', '1.0.0');

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    await scanner.bootstrap();

    const apps = scanner.getActiveApps();
    expect(apps).toHaveLength(2);
    expect(apps.find((p) => p.manifest.id === 'p1').state).toBe('active');
    expect(apps.find((p) => p.manifest.id === 'p2').state).toBe('active');
  });

  it('getAppManifest returns parsed manifest', async () => {
    createTestApp(appsDir, 'my-app', '0.5.0', { description: 'My app' });

    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    await scanner.bootstrap();

    const manifest = scanner.getAppManifest('my-app');
    expect(manifest.id).toBe('my-app');
    expect(manifest.version).toBe('0.5.0');
    expect(manifest.description).toBe('My app');
  });

  it('getAppManifest returns undefined for unknown app', () => {
    const scanner = createAppScanner(appRouter, appsDir, dataDir);
    expect(scanner.getAppManifest('ghost')).toBeUndefined();
  });
});
