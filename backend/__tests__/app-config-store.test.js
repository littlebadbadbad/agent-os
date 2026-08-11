/**
 * Tests for backend/lib/app-config-store.js
 *
 * Uses stringContaining for path assertions to handle Windows vs Unix slashes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('fs', () => mockFs);

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const DATA_ROOT = '/mock/data';
const APP_DIR = '/mock/data/app-data/my-app';
const CONFIG_PATH = '/mock/data/app-data/my-app/config.json';

let store;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../lib/app-config-store.js');
  store = mod.createAppConfigStore(DATA_ROOT);
});

describe('createAppConfigStore', () => {
  it('returns load, save, getConfigPath methods', () => {
    expect(store).toHaveProperty('load');
    expect(store).toHaveProperty('save');
    expect(store).toHaveProperty('getConfigPath');
  });

  describe('getConfigPath', () => {
    it('returns path ending with app-data/my-app/config.json', () => {
      const result = store.getConfigPath('my-app');
      expect(result).toMatch(/app-data[/\\]my-app[/\\]config\.json$/);
    });

    it('handles app IDs with special characters', () => {
      const path = store.getConfigPath('my-cool-app_v2');
      expect(path).toMatch(/my-cool-app_v2[/\\]config\.json$/);
    });
  });

  describe('load', () => {
    it('returns empty object when file missing and no manifest', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(store.load('my-app')).toEqual({});
      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });

    it('reads and parses config file', () => {
      const data = { theme: 'dark', fontSize: 14 };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(data));

      expect(store.load('my-app')).toEqual(data);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/my-app[/\\]config\.json$/), 'utf-8',
      );
    });

    it('merges manifest defaults, saved overrides', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ theme: 'light' }));

      const m = { configuration: { properties: { theme: { default: 'dark' }, fontSize: { default: 12 }, flag: { default: true } } } };
      const r = store.load('my-app', m);
      expect(r.theme).toBe('light');
      expect(r.fontSize).toBe(12);
      expect(r.flag).toBe(true);
    });

    it('uses defaults when config file missing', () => {
      mockFs.existsSync.mockReturnValue(false);
      const m = { configuration: { properties: { x: { default: 1 }, y: { default: 'a' } } } };
      expect(store.load('my-app', m)).toEqual({ x: 1, y: 'a' });
    });

    it('handles no configuration property in manifest', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(store.load('my-app', {})).toEqual({});
    });

    it('handles empty properties', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(store.load('my-app', { configuration: { properties: {} } })).toEqual({});
    });

    it('creates nested objects from dot-separated keys', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{}');
      const m = { configuration: { properties: { 'ui.theme': { default: 'dark' }, 'ui.size': { default: 14 } } } };
      expect(store.load('my-app', m)).toEqual({ ui: { theme: 'dark', size: 14 } });
    });

    it('shallow merge: saved nested value replaces entire default nested object', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ ui: { theme: 'light' } }));
      const m = { configuration: { properties: { 'ui.theme': { default: 'dark' }, 'ui.size': { default: 14 } } } };
      const r = store.load('my-app', m);
      expect(r.ui.theme).toBe('light');
      expect(r.ui.size).toBeUndefined(); // lost due to shallow merge
    });

    it('handles 3+ level dot-separated keys', () => {
      mockFs.existsSync.mockReturnValue(false);
      const m = { configuration: { properties: { 'a.b.c': { default: 'deep' } } } };
      expect(store.load('my-app', m)).toEqual({ a: { b: { c: 'deep' } } });
    });

    it('returns {} for corrupted JSON', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{ bad }');
      expect(store.load('my-app')).toEqual({});
    });

    it('returns saved config when no manifest', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ k: 'v' }));
      expect(store.load('my-app')).toEqual({ k: 'v' });
    });

    it('handles various default types', () => {
      mockFs.existsSync.mockReturnValue(false);
      const m = { configuration: { properties: { n: { default: 42 }, s: { default: 'x' }, b: { default: false } } } };
      expect(store.load('my-app', m)).toEqual({ n: 42, s: 'x', b: false });
    });

    it('handles null default', () => {
      mockFs.existsSync.mockReturnValue(false);
      const m = { configuration: { properties: { x: { default: null } } } };
      expect(store.load('my-app', m)).toEqual({ x: null });
    });
  });

  describe('save', () => {
    it('writes config creating dir when needed', () => {
      mockFs.existsSync.mockReturnValue(false);
      store.save('my-app', { theme: 'dark', count: 5 });

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringMatching(/my-app$/), { recursive: true },
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/my-app[/\\]config\.json$/),
        JSON.stringify({ theme: 'dark', count: 5 }, null, 2), 'utf-8',
      );
    });

    it('skips mkdir when dir exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      store.save('my-app', { v: 2 });
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('saves empty object', () => {
      mockFs.existsSync.mockReturnValue(true);
      store.save('my-app', {});
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/config\.json$/), '{}', 'utf-8',
      );
    });

    it('does not throw on writeFileSync failure (in try/catch)', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });
      expect(() => store.save('my-app', { k: 'v' })).not.toThrow();
    });

    it('throws on mkdirSync failure (outside try/catch)', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => { throw new Error('perm'); });
      expect(() => store.save('my-app', { k: 'v' })).toThrow('perm');
    });
  });
});
