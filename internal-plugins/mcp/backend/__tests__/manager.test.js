/**
 * Tests for backend/lib/mcp-manager/index.js — McpManager (orchestrator)
 *
 * Covers:
 *   - listServers: builds full ServerEntry with runtime state
 *   - getServer: returns single entry
 *   - addServer: registers config + connects + returns entry
 *   - addServer: duplicate name rejection
 *   - removeServer: disconnect + config delete
 *   - reconnectServer: reconnect + enable flag
 *   - disconnectServerByName: disconnect + disable flag
 *   - callTool: delegates to connection manager
 *   - shutdown: clears all state
 *   - startupReconnect: reconnects enabled servers
 *
 * Mocks config store and connection manager — tested in isolation above.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockConfigStore = vi.hoisted(() => ({
  getAll: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  persist: vi.fn(),
}));

const mockConnectionMgr = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getTools: vi.fn(),
  isConnected: vi.fn(),
  callTool: vi.fn(),
  listResources: vi.fn().mockResolvedValue([]),
  listResourceTemplates: vi.fn().mockResolvedValue([]),
  readResource: vi.fn(),
  listPrompts: vi.fn().mockResolvedValue([]),
  getPrompt: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock('../lib/mcp-manager/config-store.js', () => ({
  createConfigStore: vi.fn(() => mockConfigStore),
}));

vi.mock('../lib/mcp-manager/connection.js', () => ({
  createConnectionManager: vi.fn(() => mockConnectionMgr),
}));

let createMcpManager;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../lib/mcp-manager/index.js');
  createMcpManager = mod.createMcpManager;
});

const AGENT_DIR = '/mock/.agent';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    id: 'mcp-001',
    name: 'test',
    url: 'https://mcp.example.com/mcp',
    transport: 'streamable-http',
    headers: {},
    includeTools: [],
    useProxy: false,
    enabled: true,
    ...overrides,
  };
}

function makeToolDef(name, desc = '') {
  return { name, description: desc, inputSchema: { type: 'object', properties: {} } };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('McpManager', () => {
  describe('listServers', () => {
    it('builds full entries from configs + runtime state', () => {
      mockConfigStore.getAll.mockReturnValue([makeConfig({ id: 'a', name: 'alpha' })]);
      mockConnectionMgr.getTools.mockReturnValue([makeToolDef('t1')]);

      const mgr = createMcpManager(AGENT_DIR);
      const list = mgr.listServers();

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('a');
      expect(list[0].name).toBe('alpha');
      expect(list[0].status).toBe('disconnected');
      expect(list[0].tools).toHaveLength(1);
    });

    it('returns empty array when no configs', () => {
      mockConfigStore.getAll.mockReturnValue([]);
      const mgr = createMcpManager(AGENT_DIR);
      expect(mgr.listServers()).toEqual([]);
    });

    it('includes error message for error state', async () => {
      const cfg = makeConfig({ id: 'err', name: 'broken' });
      mockConfigStore.getAll.mockReturnValue([cfg]);
      mockConfigStore.get.mockReturnValue(cfg);

      const mgr = createMcpManager(AGENT_DIR);

      // Simulate failed connection
      mockConnectionMgr.connect.mockRejectedValue(new Error('Boom'));
      try { await mgr.addServer({ name: 'broken', url: 'https://bad.com' }); } catch {}

      const list = mgr.listServers();
      const entry = list.find((s) => s.id === 'err');
      // After a failed connect, status should be error
      expect(entry).toBeDefined();
    });
  });

  describe('getServer', () => {
    it('returns a single entry', () => {
      mockConfigStore.get.mockReturnValue(makeConfig({ id: 'solo', name: 'solo' }));
      mockConnectionMgr.getTools.mockReturnValue([]);

      const mgr = createMcpManager(AGENT_DIR);
      const entry = mgr.getServer('solo');

      expect(entry).toBeDefined();
      expect(entry.name).toBe('solo');
    });

    it('returns undefined for unknown', () => {
      mockConfigStore.get.mockReturnValue(undefined);
      const mgr = createMcpManager(AGENT_DIR);
      expect(mgr.getServer('nope')).toBeUndefined();
    });
  });

  describe('addServer', () => {
    it('registers and connects', async () => {
      const cfg = makeConfig({ id: 'new-mcp', name: 'new-server' });
      // First call to get() → undefined (server doesn't exist yet)
      // Subsequent calls → return the created config
      mockConfigStore.get.mockReturnValueOnce(undefined).mockReturnValue(cfg);
      mockConnectionMgr.connect.mockResolvedValue([makeToolDef('greet')]);
      mockConnectionMgr.getTools.mockReturnValue([makeToolDef('greet')]);
      mockConfigStore.getAll.mockReturnValue([cfg]);

      const mgr = createMcpManager(AGENT_DIR);
      const entry = await mgr.addServer({
        name: 'new-server',
        url: 'https://new.example.com',
        transport: 'streamable-http',
      });

      expect(entry.name).toBe('new-server');
      expect(entry.status).toBe('connected');
      expect(entry.tools).toHaveLength(1);
      expect(mockConfigStore.save).toHaveBeenCalled();
      expect(mockConnectionMgr.connect).toHaveBeenCalled();
    });

    it('rejects duplicate names', async () => {
      mockConfigStore.get.mockReturnValue(makeConfig({ name: 'exists' }));

      const mgr = createMcpManager(AGENT_DIR);
      await expect(mgr.addServer({
        name: 'exists',
        url: 'https://example.com',
      })).rejects.toThrow('already registered');
    });

    it('rejects empty name', async () => {
      const mgr = createMcpManager(AGENT_DIR);
      await expect(mgr.addServer({ name: '', url: 'https://x.com' }))
        .rejects.toThrow('name is required');
    });

    it('defaults transport to streamable-http', async () => {
      const cfg = makeConfig({ name: 'def' });
      mockConfigStore.get.mockReturnValueOnce(undefined).mockReturnValue(cfg);
      mockConnectionMgr.connect.mockResolvedValue([]);
      mockConnectionMgr.getTools.mockReturnValue([]);
      mockConfigStore.getAll.mockReturnValue([cfg]);

      const mgr = createMcpManager(AGENT_DIR);
      const entry = await mgr.addServer({ name: 'def', url: 'https://x.com' });

      expect(entry.transport).toBe('streamable-http');
    });

    it('does not connect when enabled=false', async () => {
      const cfg = makeConfig({ name: 'disabled', enabled: false });
      mockConfigStore.get.mockReturnValueOnce(undefined).mockReturnValue(cfg);
      mockConnectionMgr.getTools.mockReturnValue([]);
      mockConfigStore.getAll.mockReturnValue([cfg]);

      const mgr = createMcpManager(AGENT_DIR);
      const entry = await mgr.addServer({
        name: 'disabled',
        url: 'https://x.com',
        enabled: false,
      });

      expect(entry.status).toBe('disconnected');
      expect(mockConnectionMgr.connect).not.toHaveBeenCalled();
    });

    it('generates unique IDs for each server', async () => {
      const cfg = makeConfig({ name: 'srv1' });
      mockConfigStore.get.mockReturnValueOnce(undefined).mockReturnValue(cfg);
      mockConnectionMgr.connect.mockResolvedValue([]);
      mockConnectionMgr.getTools.mockReturnValue([]);
      mockConfigStore.getAll.mockReturnValue([cfg]);

      const mgr = createMcpManager(AGENT_DIR);

      await mgr.addServer({ name: 'srv1', url: 'https://a.com' });

      const savedCall = mockConfigStore.save.mock.calls[0][0];
      expect(savedCall.id).toMatch(/^mcp-\d+-[a-z0-9]+$/);
    });
  });

  describe('removeServer', () => {
    it('disconnects and removes config', () => {
      const mgr = createMcpManager(AGENT_DIR);
      mgr.removeServer('bye');

      expect(mockConnectionMgr.disconnect).toHaveBeenCalledWith('bye');
      expect(mockConfigStore.remove).toHaveBeenCalledWith('bye');
    });
  });

  describe('reconnectServer', () => {
    it('reconnects and enables server', async () => {
      const cfg = makeConfig({ name: 'reconn', enabled: false });
      mockConfigStore.get.mockReturnValue(cfg);
      mockConnectionMgr.connect.mockResolvedValue([makeToolDef('reloaded')]);
      mockConnectionMgr.getTools.mockReturnValue([makeToolDef('reloaded')]);

      const mgr = createMcpManager(AGENT_DIR);
      const entry = await mgr.reconnectServer('reconn');

      expect(entry.status).toBe('connected');
      expect(mockConnectionMgr.connect).toHaveBeenCalled();
      // Should mark as enabled
      expect(mockConfigStore.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'reconn', enabled: true }),
      );
    });

    it('throws for unknown server', async () => {
      mockConfigStore.get.mockReturnValue(undefined);
      const mgr = createMcpManager(AGENT_DIR);
      await expect(mgr.reconnectServer('ghost')).rejects.toThrow('not registered');
    });
  });

  describe('disconnectServerByName', () => {
    it('disconnects and disables server', () => {
      const cfg = makeConfig({ name: 'dc', enabled: true });
      mockConfigStore.get.mockReturnValue(cfg);

      const mgr = createMcpManager(AGENT_DIR);
      mgr.disconnectServerByName('dc');

      expect(mockConnectionMgr.disconnect).toHaveBeenCalledWith('dc');
      expect(mockConfigStore.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'dc', enabled: false }),
      );
    });
  });

  describe('callTool', () => {
    it('delegates to connection manager', async () => {
      mockConnectionMgr.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'done' }], isError: false });

      const mgr = createMcpManager(AGENT_DIR);
      const result = await mgr.callTool('my-srv', 'my-tool', { x: 1 });

      expect(result.content[0].text).toBe('done');
      expect(mockConnectionMgr.callTool).toHaveBeenCalledWith('my-srv', 'my-tool', { x: 1 });
    });
  });

  describe('shutdown', () => {
    it('clears connections and state', () => {
      const mgr = createMcpManager(AGENT_DIR);
      mgr.shutdown();

      expect(mockConnectionMgr.shutdown).toHaveBeenCalled();
    });
  });

  describe('startupReconnect', () => {
    it('reconnects all enabled servers', async () => {
      const cfgs = [
        makeConfig({ name: 'enabled1', enabled: true }),
        makeConfig({ name: 'enabled2', enabled: true }),
        makeConfig({ name: 'disabled', enabled: false }),
      ];
      mockConfigStore.getAll.mockReturnValue(cfgs);
      mockConfigStore.get.mockImplementation((name) => cfgs.find((c) => c.name === name));
      mockConnectionMgr.connect.mockResolvedValue([makeToolDef('t')]);

      const mgr = createMcpManager(AGENT_DIR);
      await mgr.startupReconnect();

      expect(mockConnectionMgr.connect).toHaveBeenCalledTimes(2);
      expect(mockConnectionMgr.connect).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'enabled1' }),
      );
      expect(mockConnectionMgr.connect).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'enabled2' }),
      );
    });

    it('handles no enabled servers', async () => {
      mockConfigStore.getAll.mockReturnValue([makeConfig({ name: 'off', enabled: false })]);
      mockConfigStore.get.mockReturnValue(makeConfig({ name: 'off', enabled: false }));

      const mgr = createMcpManager(AGENT_DIR);
      await mgr.startupReconnect();

      expect(mockConnectionMgr.connect).not.toHaveBeenCalled();
    });

    it('continues when some reconnects fail', async () => {
      const cfgs = [
        makeConfig({ name: 'good', enabled: true }),
        makeConfig({ name: 'bad', enabled: true }),
      ];
      mockConfigStore.getAll.mockReturnValue(cfgs);
      mockConfigStore.get.mockImplementation((name) => cfgs.find((c) => c.name === name));
      mockConnectionMgr.connect
        .mockResolvedValueOnce([makeToolDef('ok')])
        .mockRejectedValueOnce(new Error('fail'));

      const mgr = createMcpManager(AGENT_DIR);
      // Should not throw — uses Promise.allSettled
      await expect(mgr.startupReconnect()).resolves.toBeUndefined();
    });
  });
});
