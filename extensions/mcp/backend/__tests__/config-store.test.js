/**
 * Tests for backend/lib/mcp-manager/config-store.js
 *
 * Covers:
 *   - Load persisted configs from disk on creation
 *   - Save new configs + persist to JSON file
 *   - Remove configs
 *   - get / getAll
 *   - Corrupted JSON file → graceful empty state
 *   - Missing file → graceful empty state
 *   - Persist writes correct shape (strips runtime-only fields)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('fs', () => mockFs);

let createConfigStore;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../lib/mcp-manager/config-store.js');
  createConfigStore = mod.createConfigStore;
});

const AGENT_DIR = '/mock/.agent';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    id: 'mcp-001',
    name: 'test-server',
    url: 'https://mcp.example.com/mcp',
    transport: 'streamable-http',
    headers: {},
    includeTools: [],
    useProxy: false,
    enabled: true,
    ...overrides,
  };
}

function makePersistedConfigs(...cfgs) {
  return JSON.stringify(cfgs.map((c) => ({
    id: c.id, name: c.name, url: c.url, transport: c.transport,
    headers: c.headers, includeTools: c.includeTools, useProxy: c.useProxy, enabled: c.enabled,
  })));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConfigStore', () => {
  describe('creation', () => {
    it('creates .agent directory if missing', () => {
      mockFs.existsSync.mockReturnValue(false);
      createConfigStore(AGENT_DIR);
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(AGENT_DIR, { recursive: true });
    });

    it('loads persisted configs from disk', () => {
      mockFs.existsSync.mockReturnValueOnce(true); // for .agent dir
      const cfg = makeConfig();
      mockFs.readFileSync.mockReturnValue(makePersistedConfigs(cfg));

      // Second existsSync — for the config file
      mockFs.existsSync.mockReturnValue(true);

      const store = createConfigStore(AGENT_DIR);
      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].name).toBe('test-server');
    });

    it('handles missing mcp-servers.json gracefully', () => {
      // mkdirSync is called first (always, for the directory)
      // existsSync: first call checks if the config file exists
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);
      expect(store.getAll()).toEqual([]);
    });

    it('handles corrupted JSON gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{ corrupted json!!!');
      const store = createConfigStore(AGENT_DIR);
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('getAll', () => {
    it('returns all configs sorted by insertion order', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);

      store.save(makeConfig({ name: 'alpha' }));
      store.save(makeConfig({ name: 'beta' }));
      store.save(makeConfig({ name: 'gamma' }));

      const names = store.getAll().map((c) => c.name);
      expect(names).toEqual(['alpha', 'beta', 'gamma']);
    });
  });

  describe('get', () => {
    it('returns config by name', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);
      store.save(makeConfig({ name: 'find-me', id: 'xyz' }));
      const cfg = store.get('find-me');
      expect(cfg).toBeDefined();
      expect(cfg.id).toBe('xyz');
    });

    it('returns undefined for unknown name', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);
      expect(store.get('nope')).toBeUndefined();
    });
  });

  describe('save', () => {
    it('persists to JSON file on save', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);
      store.save(makeConfig({ name: 'persist-me', id: 'mcp-persist' }));

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].id).toBe('mcp-persist');
    });

    it('strips runtime-only fields (tools, status, errorMsg)', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);
      // Even if we add extra fields, they should be stripped on persist
      store.save(makeConfig({ name: 'clean', runtimeExtra: 'should not persist' }));

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
      const keys = Object.keys(written[0]).sort();
      expect(keys).not.toContain('tools');
      expect(keys).not.toContain('status');
      expect(keys).not.toContain('errorMsg');
      expect(keys).not.toContain('runtimeExtra');
      // Core fields should be present
      expect(keys).toContain('id');
      expect(keys).toContain('name');
      expect(keys).toContain('url');
      expect(keys).toContain('transport');
      expect(keys).toContain('enabled');
    });

    it('updates existing config with same name', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);
      store.save(makeConfig({ name: 'dual', id: 'first' }));
      store.save(makeConfig({ name: 'dual', id: 'second' }));

      expect(store.getAll()).toHaveLength(1);
      expect(store.get('dual').id).toBe('second');
    });

    it('handles write errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation(() => { throw new Error('Disk full'); });
      const store = createConfigStore(AGENT_DIR);
      // Should not throw
      expect(() => store.save(makeConfig({ name: 'no-crash' }))).not.toThrow();
    });
  });

  describe('remove', () => {
    it('removes config and persists', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);
      store.save(makeConfig({ name: 'delete-me' }));
      store.save(makeConfig({ name: 'keep-me' }));

      store.remove('delete-me');
      expect(store.getAll()).toHaveLength(1);
      expect(store.get('keep-me')).toBeDefined();
      expect(store.get('delete-me')).toBeUndefined();
    });

    it('is a no-op for unknown name', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);
      store.save(makeConfig({ name: 'only' }));
      store.remove('ghost');
      expect(store.getAll()).toHaveLength(1);
    });
  });

  describe('persist', () => {
    it('writes current state to disk', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);
      store.save(makeConfig({ name: 'a' }));
      store.save(makeConfig({ name: 'b' }));

      mockFs.writeFileSync.mockClear(); // reset after saves
      store.persist();

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
      expect(written).toHaveLength(2);
    });
  });

  describe('transport types', () => {
    it('preserves all three transport types', () => {
      mockFs.existsSync.mockReturnValue(false);
      const store = createConfigStore(AGENT_DIR);

      for (const transport of ['streamable-http', 'legacy-sse', 'stdio']) {
        store.save(makeConfig({ name: `srv-${transport}`, transport }));
      }

      expect(store.getAll()).toHaveLength(3);
      expect(store.get('srv-streamable-http').transport).toBe('streamable-http');
      expect(store.get('srv-legacy-sse').transport).toBe('legacy-sse');
      expect(store.get('srv-stdio').transport).toBe('stdio');
    });
  });
});
