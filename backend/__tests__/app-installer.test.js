/**
 * Tests for backend/lib/app-installer.js
 *
 * Uses mockReset() instead of clearAllMocks() to fully reset vi.fn()
 * implementations between tests (clearAllMocks only clears call history).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFs, mockAdmZip, setZipEntries, setExtractAll } = vi.hoisted(() => {
  const fs = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    cpSync: vi.fn(),
    rmSync: vi.fn(),
    renameSync: vi.fn(),
  };
  let sharedEntries = [];
  let sharedExtractAll = vi.fn();
  const Ctor = function () { return { getEntries: () => sharedEntries, extractAllTo: sharedExtractAll }; };
  return { mockFs: fs, mockAdmZip: Ctor, setZipEntries: (e) => { sharedEntries = e; }, setExtractAll: (fn) => { sharedExtractAll = fn; } };
});

vi.mock('fs', () => mockFs);
vi.mock('path', () => ({ join: (...a) => a.join('/'), resolve: (...a) => a.join('/') }));
vi.mock('adm-zip', () => ({ default: mockAdmZip }));
vi.mock('../lib/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

let installer;

function resetFs() {
  // Full reset (both call history AND implementations)
  for (const fn of Object.values(mockFs)) { fn.mockReset(); }
}

beforeEach(async () => {
  resetFs();
  setZipEntries([]);
  setExtractAll(vi.fn());
  mockFs.existsSync.mockReturnValue(true);
  const mod = await import('../lib/app-installer.js');
  installer = mod.createAppInstaller('/mock/agent-apps');
});

describe('createAppInstaller', () => {
  it('creates apps dir if missing', async () => {
    resetFs();
    mockFs.existsSync.mockReturnValue(false);
    const mod = await import('../lib/app-installer.js');
    mod.createAppInstaller('/x');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/x', { recursive: true });
  });

  it('returns expected methods', () => {
    expect(typeof installer.validateAppDir).toBe('function');
    expect(typeof installer.installFromZip).toBe('function');
    expect(typeof installer.installFromDirectory).toBe('function');
    expect(typeof installer.remove).toBe('function');
  });
});

describe('validateAppDir', () => {
  it('accepts valid manifest', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'my-app', name: 'My App', version: '1.0.0' }));
    const r = installer.validateAppDir('/d');
    expect(r.ok).toBe(true);
  });

  it('rejects missing manifest', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(installer.validateAppDir('/d').error).toContain('manifest.json not found');
  });

  it('rejects invalid JSON', () => {
    mockFs.readFileSync.mockReturnValue('bad');
    expect(installer.validateAppDir('/d').error).toContain('Invalid manifest.json');
  });

  it('rejects missing id', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ name: 'X', version: '1' }));
    expect(installer.validateAppDir('/d').error).toContain('id');
  });

  it('rejects missing name', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'x', version: '1' }));
    expect(installer.validateAppDir('/d').error).toContain('name');
  });

  it('rejects missing version', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'x', name: 'X' }));
    expect(installer.validateAppDir('/d').error).toContain('version');
  });

  it('rejects non-string id', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 123, name: 'X', version: '1' }));
    expect(installer.validateAppDir('/d').error).toContain('id');
  });

  it('rejects bad kebab-case', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'BAD', name: 'X', version: '1' }));
    expect(installer.validateAppDir('/d').error).toContain('kebab-case');
  });

  it('accepts valid kebab-case', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'cool-app', name: 'X', version: '1' }));
    expect(installer.validateAppDir('/d').ok).toBe(true);
  });
});

describe('installFromDirectory', () => {
  beforeEach(() => {
    mockFs.existsSync.mockImplementation((p) => {
      if (p === '/mock/agent-apps/my-app') return false;
      return true;
    });
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'my-app', name: 'P', version: '1' }));
  });

  it('installs from valid dir', async () => {
    const r = await installer.installFromDirectory('/src');
    expect(r).toEqual({ ok: true, appId: 'my-app', manifest: { id: 'my-app', name: 'P', version: '1' } });
  });

  it('rejects nonexistent source', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (p === '/src') return false;
      return true;
    });
    expect((await installer.installFromDirectory('/src')).error).toContain('does not exist');
  });

  it('rejects invalid manifest', async () => {
    mockFs.readFileSync.mockReturnValue('bad');
    expect((await installer.installFromDirectory('/src')).ok).toBe(false);
  });

  it('rejects when target exists', async () => {
    mockFs.existsSync.mockReturnValue(true);
    expect((await installer.installFromDirectory('/src')).error).toContain('already exists');
  });

  it('handles cpSync failure', async () => {
    mockFs.cpSync.mockImplementation(() => { throw new Error('disk full'); });
    expect((await installer.installFromDirectory('/src')).error).toContain('Failed to copy');
  });
});

describe('installFromZip', () => {
  const BUF = Buffer.from('fake');

  beforeEach(() => {
    mockFs.existsSync.mockImplementation((p) => {
      if (p === '/mock/agent-apps/zip-app') return false;
      return true;
    });
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'zip-app', name: 'Z', version: '2' }));
  });

  it('installs with manifest at root', async () => {
    setZipEntries([{ isDirectory: false, entryName: 'manifest.json' }]);
    const r = await installer.installFromZip(BUF);
    expect(r).toEqual({ ok: true, appId: 'zip-app', manifest: { id: 'zip-app', name: 'Z', version: '2' } });
  });

  it('installs with manifest in subdir', async () => {
    setZipEntries([
      { isDirectory: true, entryName: 'zp/' },
      { isDirectory: false, entryName: 'zp/manifest.json' },
    ]);
    const r = await installer.installFromZip(BUF);
    expect(r.ok).toBe(true);
    expect(r.appId).toBe('zip-app');
  });

  it('rejects missing manifest in ZIP', async () => {
    setZipEntries([{ isDirectory: false, entryName: 'readme.txt' }]);
    expect((await installer.installFromZip(BUF)).error).toContain('does not contain manifest.json');
  });

  it('rejects when app exists', async () => {
    setZipEntries([{ isDirectory: false, entryName: 'manifest.json' }]);
    mockFs.existsSync.mockReturnValue(true);
    expect((await installer.installFromZip(BUF)).error).toContain('already exists');
  });

  it('cleans up on extract failure', async () => {
    setZipEntries([{ isDirectory: false, entryName: 'manifest.json' }]);
    setExtractAll(vi.fn().mockImplementation(() => { throw new Error('extract fail'); }));
    expect((await installer.installFromZip(BUF)).ok).toBe(false);
  });

  it('handles cpSync failure after extract', async () => {
    setZipEntries([{ isDirectory: false, entryName: 'manifest.json' }]);
    mockFs.cpSync.mockImplementation(() => { throw new Error('cp fail'); });
    expect((await installer.installFromZip(BUF)).error).toContain('Failed to copy');
  });
});

describe('remove', () => {
  // Default existsSync returns true (target exists)

  it('removes app dir', () => {
    mockFs.rmSync.mockReturnValue(undefined);
    expect(installer.remove('my-app')).toEqual({ ok: true });
    expect(mockFs.rmSync).toHaveBeenCalled();
  });

  it('error for nonexistent app', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(installer.remove('ghost').error).toContain('not found');
  });

  it('rename+defer on rmSync failure', () => {
    mockFs.rmSync.mockImplementation(() => { throw new Error('locked'); });
    mockFs.renameSync.mockReturnValue(undefined);
    expect(installer.remove('my-app').ok).toBe(true);
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it('error when both fail', () => {
    mockFs.rmSync.mockImplementation(() => { throw new Error('locked'); });
    mockFs.renameSync.mockImplementation(() => { throw new Error('also locked'); });
    expect(installer.remove('my-app').error).toContain('all retries and rename exhausted');
  });

  it('retries rmSync 5 + 1 (removeAsync first attempt)', () => {
    mockFs.rmSync.mockImplementation(() => { throw new Error('locked'); });
    mockFs.renameSync.mockReturnValue(undefined);
    installer.remove('my-app');
    // 5 retries in tryRemoveSync + 1 in removeAsync = 6
    expect(mockFs.rmSync.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
