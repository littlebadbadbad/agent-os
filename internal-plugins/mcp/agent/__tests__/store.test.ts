/**
 * Tests for agent/store.ts — McpStore
 *
 * Covers:
 *   - getAll: returns current snapshot
 *   - get / getByName: lookup by id or name
 *   - setAll: bulk replace
 *   - remove: delete by id
 *   - setStatus: update status + errorMsg in place
 *   - immutability: mutations don't leak through returned references
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMcpStore } from '../store';
import type { McpServerEntry } from '../types';
import type { ToolDef } from '../protocol';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: 'mcp-test-001',
    name: 'test-server',
    url: 'https://mcp.example.com/mcp',
    transport: 'streamable-http',
    headers: {},
    includeTools: [],
    enabled: true,
    useProxy: false,
    status: 'disconnected',
    errorMsg: '',
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    ...overrides,
  };
}

function makeToolDef(name: string, desc: string): ToolDef {
  return {
    name,
    description: desc,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('McpStore', () => {
  let store: ReturnType<typeof createMcpStore>;

  beforeEach(() => {
    store = createMcpStore();
  });

  describe('getAll', () => {
    it('returns an empty array when no servers are set', () => {
      expect(store.getAll()).toEqual([]);
    });

    it('returns all servers after setAll', () => {
      const s1 = makeEntry({ id: 'mcp-1', name: 's1' });
      const s2 = makeEntry({ id: 'mcp-2', name: 's2' });
      store.setAll([s1, s2]);
      expect(store.getAll()).toHaveLength(2);
    });

    it('returns a snapshot, not the internal reference (no mutation leak)', () => {
      const s1 = makeEntry({ id: 'mcp-1', name: 's1' });
      store.setAll([s1]);
      const snapshot = store.getAll();
      store.setAll([]);
      // Snapshot is a fresh array
      expect(snapshot).toHaveLength(1);
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('returns entry by id', () => {
      store.setAll([makeEntry({ id: 'mcp-abc', name: 'abc' })]);
      const entry = store.get('mcp-abc');
      expect(entry).toBeDefined();
      expect(entry!.name).toBe('abc');
    });

    it('returns undefined for unknown id', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getByName', () => {
    it('returns entry by name', () => {
      store.setAll([
        makeEntry({ id: 'mcp-1', name: 'alpha' }),
        makeEntry({ id: 'mcp-2', name: 'beta' }),
      ]);
      expect(store.getByName('beta')!.id).toBe('mcp-2');
    });

    it('returns undefined for unknown name', () => {
      expect(store.getByName('nope')).toBeUndefined();
    });
  });

  describe('setAll', () => {
    it('replaces all existing entries', () => {
      store.setAll([makeEntry({ id: 'old', name: 'old' })]);
      store.setAll([makeEntry({ id: 'new', name: 'new' })]);
      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].name).toBe('new');
    });

    it('handles empty array', () => {
      store.setAll([makeEntry()]);
      store.setAll([]);
      expect(store.getAll()).toEqual([]);
    });
  });

  describe('remove', () => {
    it('removes entry by id', () => {
      store.setAll([
        makeEntry({ id: 'mcp-1', name: 'keep' }),
        makeEntry({ id: 'mcp-2', name: 'remove-me' }),
      ]);
      store.remove('mcp-2');
      expect(store.getAll()).toHaveLength(1);
      expect(store.getAll()[0].name).toBe('keep');
    });

    it('is a no-op for unknown id', () => {
      store.setAll([makeEntry()]);
      store.remove('bogus');
      expect(store.getAll()).toHaveLength(1);
    });
  });

  describe('setStatus', () => {
    it('updates status and clears errorMsg when not provided', () => {
      store.setAll([makeEntry({ id: 'mcp-1', status: 'disconnected', errorMsg: 'old err' })]);
      store.setStatus('mcp-1', 'connecting');
      const entry = store.get('mcp-1')!;
      expect(entry.status).toBe('connecting');
      expect(entry.errorMsg).toBe('');
    });

    it('updates status and sets errorMsg', () => {
      store.setAll([makeEntry({ id: 'mcp-1' })]);
      store.setStatus('mcp-1', 'error', 'Connection refused');
      const entry = store.get('mcp-1')!;
      expect(entry.status).toBe('error');
      expect(entry.errorMsg).toBe('Connection refused');
    });

    it('does not mutate other entries', () => {
      store.setAll([
        makeEntry({ id: 'mcp-1', name: 'a' }),
        makeEntry({ id: 'mcp-2', name: 'b' }),
      ]);
      store.setStatus('mcp-1', 'connected');
      expect(store.get('mcp-2')!.status).toBe('disconnected');
    });
  });

  describe('tools integration', () => {
    it('preserves tools array after setAll', () => {
      const tools: readonly ToolDef[] = [
        makeToolDef('search', 'Search the database'),
        makeToolDef('create', 'Create a record'),
      ];
      store.setAll([makeEntry({ id: 'mcp-1', tools, status: 'connected' })]);
      const entry = store.get('mcp-1')!;
      expect(entry.tools).toHaveLength(2);
      expect(entry.tools[0].name).toBe('search');
      expect(entry.tools[1].inputSchema.type).toBe('object');
    });
  });
});
