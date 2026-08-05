/**
 * Tests for backend/services/mcp.js — McpService
 *
 * Covers:
 *   - getMcpServers: wraps manager.listServers()
 *   - addMcpServer: validates name, passes config, returns { server }
 *   - removeMcpServer: validates name, delegates
 *   - reconnectMcpServer: validates name, delegates
 *   - disconnectMcpServer: validates name, delegates
 *   - executeMcpTool: validates server + tool, returns { result }
 *   - Error propagation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let createMcpService;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../services/mcp.js');
  createMcpService = mod.createMcpService;
});

function makeMockManager() {
  return {
    listServers: vi.fn(),
    getServer: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    reconnectServer: vi.fn(),
    disconnectServerByName: vi.fn(),
    callTool: vi.fn(),
    shutdown: vi.fn(),
    startupReconnect: vi.fn(),
  };
}

function makeServerEntry(name) {
  return {
    id: `srv-${name}`,
    name,
    url: 'https://example.com/mcp',
    transport: 'streamable-http',
    headers: {},
    includeTools: [],
    enabled: true,
    useProxy: false,
    status: 'connected',
    errorMsg: '',
    tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('McpService', () => {
  describe('getMcpServers', () => {
    it('wraps manager.listServers() in { servers }', () => {
      const manager = makeMockManager();
      manager.listServers.mockReturnValue([makeServerEntry('srv1')]);

      const service = createMcpService(manager);
      const result = service.getMcpServers();

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('srv1');
    });

    it('returns empty servers array', () => {
      const manager = makeMockManager();
      manager.listServers.mockReturnValue([]);

      const service = createMcpService(manager);
      expect(service.getMcpServers()).toEqual({ servers: [] });
    });
  });

  describe('addMcpServer', () => {
    it('validates name is required', async () => {
      const manager = makeMockManager();
      const service = createMcpService(manager);

      await expect(service.addMcpServer({ name: '' })).rejects.toThrow('name is required');
      await expect(service.addMcpServer({})).rejects.toThrow('name is required');
    });

    it('passes config to manager.addServer', async () => {
      const manager = makeMockManager();
      const entry = makeServerEntry('new-srv');
      manager.addServer.mockResolvedValue(entry);

      const service = createMcpService(manager);
      const result = await service.addMcpServer({
        name: 'new-srv',
        url: 'https://test.com/mcp',
        transport: 'legacy-sse',
        headers: { 'X-Key': 'val' },
        includeTools: ['tool-a'],
        useProxy: true,
      });

      expect(result.server.name).toBe('new-srv');
      expect(manager.addServer).toHaveBeenCalledWith(expect.objectContaining({
        name: 'new-srv',
        transport: 'legacy-sse',
        useProxy: true,
        includeTools: ['tool-a'],
      }));
    });

    it('defaults transport to streamable-http', async () => {
      const manager = makeMockManager();
      manager.addServer.mockResolvedValue(makeServerEntry('defaulted'));

      const service = createMcpService(manager);
      await service.addMcpServer({ name: 'defaulted', url: 'https://x.com' });

      expect(manager.addServer).toHaveBeenCalledWith(
        expect.objectContaining({ transport: 'streamable-http' }),
      );
    });
  });

  describe('removeMcpServer', () => {
    it('validates name is required', () => {
      const manager = makeMockManager();
      const service = createMcpService(manager);

      expect(() => service.removeMcpServer({})).toThrow('name is required');
      expect(() => service.removeMcpServer({ name: '' })).toThrow('name is required');
    });

    it('delegates to manager.removeServer', () => {
      const manager = makeMockManager();
      const service = createMcpService(manager);

      const result = service.removeMcpServer({ name: 'bye' });
      expect(manager.removeServer).toHaveBeenCalledWith('bye');
      expect(result.removed).toBe('bye');
    });
  });

  describe('reconnectMcpServer', () => {
    it('validates name is required', async () => {
      const manager = makeMockManager();
      const service = createMcpService(manager);

      await expect(service.reconnectMcpServer({})).rejects.toThrow('name is required');
    });

    it('delegates and returns server', async () => {
      const manager = makeMockManager();
      const entry = makeServerEntry('reconnected');
      manager.reconnectServer.mockResolvedValue(entry);

      const service = createMcpService(manager);
      const result = await service.reconnectMcpServer({ name: 'reconnected' });

      expect(result.server.name).toBe('reconnected');
      expect(manager.reconnectServer).toHaveBeenCalledWith('reconnected');
    });
  });

  describe('disconnectMcpServer', () => {
    it('validates name is required', () => {
      const manager = makeMockManager();
      const service = createMcpService(manager);

      expect(() => service.disconnectMcpServer({})).toThrow('name is required');
    });

    it('delegates and returns disconnected', () => {
      const manager = makeMockManager();
      const service = createMcpService(manager);

      const result = service.disconnectMcpServer({ name: 'dc' });
      expect(manager.disconnectServerByName).toHaveBeenCalledWith('dc');
      expect(result.disconnected).toBe('dc');
    });
  });

  describe('executeMcpTool', () => {
    it('validates server and tool are required', async () => {
      const manager = makeMockManager();
      const service = createMcpService(manager);

      await expect(service.executeMcpTool({})).rejects.toThrow('server is required');
      await expect(service.executeMcpTool({ server: 'srv' })).rejects.toThrow('tool is required');
    });

    it('delegates to manager.callTool and wraps in { result }', async () => {
      const manager = makeMockManager();
      const toolResult = {
        content: [{ type: 'text', text: 'Success!' }, { type: 'image', mimeType: 'image/png', data: 'abc' }],
        isError: false,
      };
      manager.callTool.mockResolvedValue(toolResult);

      const service = createMcpService(manager);
      const result = await service.executeMcpTool({
        server: 'my-server',
        tool: 'do_stuff',
        args: { flag: true, count: 42 },
        sessionId: 'sess-123',
      });

      expect(result.result).toBe(toolResult);
      expect(manager.callTool).toHaveBeenCalledWith('my-server', 'do_stuff', {
        flag: true, count: 42,
      });
    });

    it('returns structured content (image, text, resource)', async () => {
      const manager = makeMockManager();
      const complexResult = {
        content: [
          { type: 'text', text: 'Analysis complete' },
          { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
          { type: 'resource', resource: { uri: 'file:///report.pdf', mimeType: 'application/pdf', text: 'PDF content' } },
        ],
        isError: false,
      };
      manager.callTool.mockResolvedValue(complexResult);

      const service = createMcpService(manager);
      const result = await service.executeMcpTool({
        server: 'analyzer',
        tool: 'analyze',
        args: {},
      });

      expect(result.result.content).toHaveLength(3);
      expect(result.result.content[0].type).toBe('text');
      expect(result.result.content[1].type).toBe('image');
      expect(result.result.content[2].type).toBe('resource');
    });

    it('propagates tool errors', async () => {
      const manager = makeMockManager();
      const errorResult = {
        content: [{ type: 'text', text: 'Rate limit exceeded' }],
        isError: true,
      };
      manager.callTool.mockResolvedValue(errorResult);

      const service = createMcpService(manager);
      const result = await service.executeMcpTool({
        server: 'api-srv', tool: 'call', args: {},
      });

      expect(result.result.isError).toBe(true);
      expect(result.result.content[0].text).toBe('Rate limit exceeded');
    });
  });
});
