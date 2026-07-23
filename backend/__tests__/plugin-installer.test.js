/**
 * Tests for backend/lib/plugin-installer.js
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
  const mod = await import('../lib/plugin-installer.js');
  installer = mod.createPluginInstaller('/mock/plugins');
});

describe('createPluginInstaller', () => {
  it('creates plugins dir if missing', async () => {
    resetFs();
    mockFs.existsSync.mockReturnValue(false);
    const mod = await import('../lib/plugin-installer.js');
    mod.createPluginInstaller('/x');
    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/x', { recursive: true });
  });

  it('returns expected methods', () => {
    expect(typeof installer.validatePluginDir).toBe('function');
    expect(typeof installer.installFromZip).toBe('function');
    expect(typeof installer.installFromDirectory).toBe('function');
    expect(typeof installer.remove).toBe('function');
  });
});

describe('validatePluginDir', () => {
  it('accepts valid manifest', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'my-plugin', name: 'My Plugin', version: '1.0.0' }));
    const r = installer.validatePluginDir('/d');
    expect(r.ok).toBe(true);
  });

  it('rejects missing manifest', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(installer.validatePluginDir('/d').error).toContain('manifest.json not found');
  });

  it('rejects invalid JSON', () => {
    mockFs.readFileSync.mockReturnValue('bad');
    expect(installer.validatePluginDir('/d').error).toContain('Invalid manifest.json');
  });

  it('rejects missing id', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ name: 'X', version: '1' }));
    expect(installer.validatePluginDir('/d').error).toContain('id');
  });

  it('rejects missing name', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'x', version: '1' }));
    expect(installer.validatePluginDir('/d').error).toContain('name');
  });

  it('rejects missing version', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'x', name: 'X' }));
    expect(installer.validatePluginDir('/d').error).toContain('version');
  });

  it('rejects non-string id', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 123, name: 'X', version: '1' }));
    expect(installer.validatePluginDir('/d').error).toContain('id');
  });

  it('rejects bad kebab-case', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'BAD', name: 'X', version: '1' }));
    expect(installer.validatePluginDir('/d').error).toContain('kebab-case');
  });

  it('accepts valid kebab-case', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'cool-plugin', name: 'X', version: '1' }));
    expect(installer.validatePluginDir('/d').ok).toBe(true);
  });
});

describe('installFromDirectory', () => {
  beforeEach(() => {
    mockFs.existsSync.mockImplementation((p) => {
      if (p === '/mock/plugins/my-plugin') return false;
      return true;
    });
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'my-plugin', name: 'P', version: '1' }));
  });

  it('installs from valid dir', async () => {
    const r = await installer.installFromDirectory('/src');
    expect(r).toEqual({ ok: true, pluginId: 'my-plugin', manifest: { id: 'my-plugin', name: 'P', version: '1' } });
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
      if (p === '/mock/plugins/zip-plugin') return false;
      return true;
    });
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ id: 'zip-plugin', name: 'Z', version: '2' }));
  });

  it('installs with manifest at root', async () => {
    setZipEntries([{ isDirectory: false, entryName: 'manifest.json' }]);
    const r = await installer.installFromZip(BUF);
    expect(r).toEqual({ ok: true, pluginId: 'zip-plugin', manifest: { id: 'zip-plugin', name: 'Z', version: '2' } });
  });

  it('installs with manifest in subdir', async () => {
    setZipEntries([
      { isDirectory: true, entryName: 'zp/' },
      { isDirectory: false, entryName: 'zp/manifest.json' },
    ]);
    const r = await installer.installFromZip(BUF);
    expect(r.ok).toBe(true);
    expect(r.pluginId).toBe('zip-plugin');
  });

  it('rejects missing manifest in ZIP', async () => {
    setZipEntries([{ isDirectory: false, entryName: 'readme.txt' }]);
    expect((await installer.installFromZip(BUF)).error).toContain('does not contain manifest.json');
  });

  it('rejects when plugin exists', async () => {
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

  it('removes plugin dir', () => {
    mockFs.rmSync.mockReturnValue(undefined);
    expect(installer.remove('my-plugin')).toEqual({ ok: true });
    expect(mockFs.rmSync).toHaveBeenCalled();
  });

  it('error for nonexistent plugin', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(installer.remove('ghost').error).toContain('not found');
  });

  it('rename+defer on rmSync failure', () => {
    mockFs.rmSync.mockImplementation(() => { throw new Error('locked'); });
    mockFs.renameSync.mockReturnValue(undefined);
    expect(installer.remove('my-plugin').ok).toBe(true);
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it('error when both fail', () => {
    mockFs.rmSync.mockImplementation(() => { throw new Error('locked'); });
    mockFs.renameSync.mockImplementation(() => { throw new Error('also locked'); });
    expect(installer.remove('my-plugin').error).toContain('all retries and rename exhausted');
  });

  it('retries rmSync 5 + 1 (removeAsync first attempt)', () => {
    mockFs.rmSync.mockImplementation(() => { throw new Error('locked'); });
    mockFs.renameSync.mockReturnValue(undefined);
    installer.remove('my-plugin');
    // 5 retries in tryRemoveSync + 1 in removeAsync = 6
    expect(mockFs.rmSync.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
