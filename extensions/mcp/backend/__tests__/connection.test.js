/**
 * Tests for backend/lib/mcp-manager/connection.js
 *
 * Covers:
 *   - connect: dispatch to correct transport based on config
 *   - disconnect: close transport and clean up
 *   - getTools / isConnected: query connection state
 *   - callTool: delegate to connected transport
 *   - callTool throws for disconnected servers
 *   - shutdown: close all connections
 *   - tool whitelist filtering (includeTools)
 *
 * Mocks all three transport factories.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks for transport modules ──────────────────────────────────────

const mockStreamableHttp = vi.hoisted(() => ({
  createStreamableHttpClient: vi.fn(),
}));

const mockLegacySse = vi.hoisted(() => ({
  createLegacySseClient: vi.fn(),
}));

const mockStdio = vi.hoisted(() => ({
  createStdioClient: vi.fn(),
}));

vi.mock('../lib/mcp-manager/transports/streamable-http.js', () => mockStreamableHttp);
vi.mock('../lib/mcp-manager/transports/legacy-sse.js', () => mockLegacySse);
vi.mock('../lib/mcp-manager/transports/stdio.js', () => mockStdio);

let createConnectionManager;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../lib/mcp-manager/connection.js');
  createConnectionManager = mod.createConnectionManager;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockClient(tools = [], callResult = { content: [{ type: 'text', text: 'ok' }] }) {
  return {
    listTools: vi.fn().mockResolvedValue(tools),
    callTool: vi.fn().mockResolvedValue(callResult),
    close: vi.fn(),
  };
}

function makeConfig(overrides = {}) {
  return {
    id: 'mcp-001',
    name: 'test',
    url: 'https://mcp.example.com',
    transport: 'streamable-http',
    headers: {},
    includeTools: undefined,
    useProxy: false,
    enabled: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConnectionManager', () => {
  describe('connect — transport dispatch', () => {
    it('creates streamable-http client', async () => {
      const client = makeMockClient([{ name: 't1', description: 'd', inputSchema: { type: 'object' } }]);
      mockStreamableHttp.createStreamableHttpClient.mockResolvedValue(client);

      const mgr = createConnectionManager();
      const tools = await mgr.connect(makeConfig({ transport: 'streamable-http' }));

      expect(mockStreamableHttp.createStreamableHttpClient).toHaveBeenCalledWith(
        'https://mcp.example.com', {}, expect.any(Object),
      );
      expect(tools).toHaveLength(1);
    });

    it('creates legacy-sse client', async () => {
      const client = makeMockClient([{ name: 'legacy_tool', inputSchema: { type: 'object' } }]);
      mockLegacySse.createLegacySseClient.mockResolvedValue(client);

      const mgr = createConnectionManager();
      const tools = await mgr.connect(makeConfig({ transport: 'legacy-sse' }));

      expect(mockLegacySse.createLegacySseClient).toHaveBeenCalled();
      expect(tools).toHaveLength(1);
    });

    it('creates stdio client', async () => {
      const client = makeMockClient([{ name: 'stdio_tool', inputSchema: { type: 'object' } }]);
      mockStdio.createStdioClient.mockResolvedValue(client);

      const mgr = createConnectionManager();
      const tools = await mgr.connect(makeConfig({ transport: 'stdio', url: 'node server.js' }));

      expect(mockStdio.createStdioClient.mock.calls[0][0]).toBe('node server.js');
      expect(tools[0].name).toBe('stdio_tool');
    });

    it('throws for unknown transport', async () => {
      const mgr = createConnectionManager();
      await expect(mgr.connect(makeConfig({ transport: 'ocean-carrier-pigeon' })))
        .rejects.toThrow('Unknown transport');
    });

    it('tears down existing connection before reconnecting', async () => {
      const oldClient = makeMockClient([{ name: 'old', inputSchema: { type: 'object' } }]);
      const newClient = makeMockClient([{ name: 'new', inputSchema: { type: 'object' } }]);

      mockStreamableHttp.createStreamableHttpClient
        .mockResolvedValueOnce(oldClient)
        .mockResolvedValueOnce(newClient);

      const mgr = createConnectionManager();

      // First connect
      await mgr.connect(makeConfig({ name: 'srv', transport: 'streamable-http' }));
      expect(oldClient.close).not.toHaveBeenCalled();

      // Second connect — should close old first
      await mgr.connect(makeConfig({ name: 'srv', transport: 'streamable-http' }));
      expect(oldClient.close).toHaveBeenCalled();
      expect(mgr.getTools('srv')[0].name).toBe('new');
    });
  });

  describe('tool whitelist', () => {
    it('filters tools when includeTools is set', async () => {
      const allTools = [
        { name: 'a', inputSchema: { type: 'object' } },
        { name: 'b', inputSchema: { type: 'object' } },
        { name: 'c', inputSchema: { type: 'object' } },
      ];
      const client = makeMockClient(allTools);
      mockStreamableHttp.createStreamableHttpClient.mockResolvedValue(client);

      const mgr = createConnectionManager();
      const tools = await mgr.connect(makeConfig({
        name: 'filtered',
        includeTools: ['a', 'c'],
      }));

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['a', 'c']);
    });

    it('returns all tools when includeTools is empty', async () => {
      const allTools = [
        { name: 'x', inputSchema: { type: 'object' } },
        { name: 'y', inputSchema: { type: 'object' } },
      ];
      const client = makeMockClient(allTools);
      mockStreamableHttp.createStreamableHttpClient.mockResolvedValue(client);

      const mgr = createConnectionManager();
      const tools = await mgr.connect(makeConfig({ includeTools: [] }));

      // includeTools is empty array (not undefined), should not filter
      // But the logic: cfg.includeTools && cfg.includeTools.length > 0
      expect(tools).toHaveLength(2);
    });
  });

  describe('disconnect', () => {
    it('closes transport and removes tools', async () => {
      const client = makeMockClient([{ name: 'temp', inputSchema: { type: 'object' } }]);
      mockStreamableHttp.createStreamableHttpClient.mockResolvedValue(client);

      const mgr = createConnectionManager();
      await mgr.connect(makeConfig({ name: 'temp-srv' }));

      expect(mgr.isConnected('temp-srv')).toBe(true);
      expect(mgr.getTools('temp-srv')).toHaveLength(1);

      mgr.disconnect('temp-srv');

      expect(client.close).toHaveBeenCalled();
      expect(mgr.isConnected('temp-srv')).toBe(false);
      expect(mgr.getTools('temp-srv')).toEqual([]);
    });

    it('is a no-op for unknown server', () => {
      const mgr = createConnectionManager();
      expect(() => mgr.disconnect('ghost')).not.toThrow();
    });

    it('handles close errors gracefully', async () => {
      const client = makeMockClient();
      client.close.mockImplementation(() => { throw new Error('close error'); });
      mockStreamableHttp.createStreamableHttpClient.mockResolvedValue(client);

      const mgr = createConnectionManager();
      await mgr.connect(makeConfig({ name: 'flaky' }));

      expect(() => mgr.disconnect('flaky')).not.toThrow();
    });
  });

  describe('callTool', () => {
    it('delegates to connected transport', async () => {
      const client = makeMockClient([], { content: [{ type: 'text', text: 'result' }], isError: false });
      mockStreamableHttp.createStreamableHttpClient.mockResolvedValue(client);

      const mgr = createConnectionManager();
      await mgr.connect(makeConfig({ name: 'executor' }));

      const result = await mgr.callTool('executor', 'run', { x: 1 });
      expect(result.content[0].text).toBe('result');
      expect(client.callTool).toHaveBeenCalledWith('run', { x: 1 });
    });

    it('throws when server is not connected', async () => {
      const mgr = createConnectionManager();
      await expect(mgr.callTool('offline', 'test', {}))
        .rejects.toThrow('not connected');
    });
  });

  describe('shutdown', () => {
    it('closes all connections', async () => {
      const client1 = makeMockClient([{ name: 't1', inputSchema: { type: 'object' } }]);
      const client2 = makeMockClient([{ name: 't2', inputSchema: { type: 'object' } }]);
      mockStreamableHttp.createStreamableHttpClient
        .mockResolvedValueOnce(client1)
        .mockResolvedValueOnce(client2);

      const mgr = createConnectionManager();
      await mgr.connect(makeConfig({ name: 'srv1' }));
      await mgr.connect(makeConfig({ name: 'srv2' }));

      mgr.shutdown();

      expect(client1.close).toHaveBeenCalled();
      expect(client2.close).toHaveBeenCalled();
      expect(mgr.isConnected('srv1')).toBe(false);
      expect(mgr.isConnected('srv2')).toBe(false);
    });

    it('is safe to call on empty manager', () => {
      const mgr = createConnectionManager();
      expect(() => mgr.shutdown()).not.toThrow();
    });
  });

  describe('connection state queries', () => {
    it('getTools returns empty array for unknown server', () => {
      const mgr = createConnectionManager();
      expect(mgr.getTools('nobody')).toEqual([]);
    });

    it('isConnected returns false for unknown server', () => {
      const mgr = createConnectionManager();
      expect(mgr.isConnected('nobody')).toBe(false);
    });
  });

  describe('proxy config forwarding', () => {
    it('passes proxy options to transport', async () => {
      const client = makeMockClient([]);
      mockStreamableHttp.createStreamableHttpClient.mockResolvedValue(client);

      const proxyConfig = { host: 'proxy.local', port: 3128, protocol: 'http' };
      const mgr = createConnectionManager(proxyConfig);

      await mgr.connect(makeConfig({ name: 'proxied', useProxy: true }));

      expect(mockStreamableHttp.createStreamableHttpClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          useProxy: true,
          proxyConfig,
        }),
      );
    });
  });
});
