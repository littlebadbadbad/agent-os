/**
 * Tests for backend/lib/app-state-store.js
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

const STATE_FILE = '/mock/data/app-state.json';
let store;

beforeEach(async () => {
  mockFs.existsSync.mockReset();
  mockFs.readFileSync.mockReset();
  mockFs.writeFileSync.mockReset();
  mockFs.mkdirSync.mockReset();
  const mod = await import('../lib/app-state-store.js');
  store = mod.createAppStateStore(STATE_FILE);
});

describe('createAppStateStore', () => {
  it('returns load, save, get, set, remove, getAll methods', () => {
    expect(store).toHaveProperty('load');
    expect(store).toHaveProperty('save');
    expect(store).toHaveProperty('get');
    expect(store).toHaveProperty('set');
    expect(store).toHaveProperty('remove');
    expect(store).toHaveProperty('getAll');
  });

  describe('get / set / remove / getAll', () => {
    it('set stores and get retrieves', () => {
      store.set('a', 'enabled');
      expect(store.get('a')).toBe('enabled');
    });

    it('get returns undefined for unset key', () => {
      expect(store.get('none')).toBeUndefined();
    });

    it('set overwrites', () => { store.set('a','x'); store.set('a','y'); expect(store.get('a')).toBe('y'); });
    it('remove deletes', () => { store.set('a','v'); store.remove('a'); expect(store.get('a')).toBeUndefined(); });
    it('remove idempotent', () => { expect(() => store.remove('m')).not.toThrow(); });

    it('getAll returns copy', () => {
      store.set('a','1'); store.set('b','2');
      const all = store.getAll();
      expect(all).toEqual({a:'1',b:'2'});
      all.c='3'; expect(store.get('c')).toBeUndefined();
    });

    it('getAll returns {} when empty', () => { expect(store.getAll()).toEqual({}); });

    it('stores various strings', () => {
      store.set('s','hello'); store.set('n','42'); store.set('e','');
      expect(store.get('s')).toBe('hello');
      expect(store.get('n')).toBe('42');
      expect(store.get('e')).toBe('');
    });
  });

  describe('load', () => {
    it('loads from valid JSON', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({a:'1',b:'2'}));
      store.load();
      expect(store.get('a')).toBe('1');
      expect(store.get('b')).toBe('2');
    });

    it('resets state when file missing', () => {
      mockFs.existsSync.mockReturnValue(false);
      store.set('old','data');
      store.load();
      expect(store.get('old')).toBeUndefined();
      expect(store.getAll()).toEqual({});
    });

    it('resets state on bad JSON', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{bad}');
      store.load();
      expect(store.getAll()).toEqual({});
    });

    it('resets state on read error', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => { throw new Error('EACCES'); });
      store.load();
      expect(store.getAll()).toEqual({});
    });

    it('handles {}', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{}');
      store.load();
      expect(store.getAll()).toEqual({});
    });

    it('replaces state on subsequent loads', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify({a:'1'})).mockReturnValueOnce(JSON.stringify({b:'2'}));
      store.load(); expect(store.getAll()).toEqual({a:'1'});
      store.load(); expect(store.getAll()).toEqual({b:'2'});
    });
  });

  describe('save', () => {
    it('persists state as JSON', () => {
      mockFs.existsSync.mockReturnValue(true);
      store.set('a','x'); store.set('b','y');
      store.save();
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(STATE_FILE, JSON.stringify({a:'x',b:'y'},null,2), 'utf-8');
    });

    it('creates parent dir when needed', () => {
      mockFs.existsSync.mockReturnValue(false);
      store.save();
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/mock/data', { recursive: true });
    });

    it('does not throw on write failure', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => { throw new Error('fail'); });
      expect(() => store.save()).not.toThrow();
    });

    it('does not throw on mkdir failure', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => { throw new Error('fail'); });
      expect(() => store.save()).not.toThrow();
    });

    it('persists empty state', () => {
      mockFs.existsSync.mockReturnValue(true);
      store.save();
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(STATE_FILE, '{}', 'utf-8');
    });

    it('calls existsSync before mkdir', () => {
      mockFs.existsSync.mockReturnValue(true);
      store.save();
      expect(mockFs.existsSync).toHaveBeenCalledWith('/mock/data');
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });
});
