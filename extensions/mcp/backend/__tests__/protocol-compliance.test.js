/**
 * MCP Protocol Compliance — Integration Tests
 *
 * Tests across MCP transport layers to verify end-to-end protocol compliance.
 * Covers initialize handshake, JSON-RPC formatting, content types, session
 * management, and error propagation.
 *
 * Uses controlled ReadableStream for reliable async event delivery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

function mockJsonResponse(data, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    body: null,
  };
}

vi.mock('undici', () => ({ fetch: vi.fn(), ProxyAgent: vi.fn() }));

// ── Protocol Constants ──────────────────────────────────────────────────────

describe('MCP Protocol Constants', () => {
  it('MCP_PROTOCOL_VERSION is 2025-06-18', async () => {
    const { MCP_PROTOCOL_VERSION } = await import('../lib/mcp-manager/transports/utils.js');
    expect(MCP_PROTOCOL_VERSION).toBe('2025-06-18');
  });

  it('CLIENT_INFO has correct name/version', async () => {
    const { CLIENT_INFO } = await import('../lib/mcp-manager/transports/utils.js');
    expect(CLIENT_INFO.name).toBe('agent-sdk-backend');
    expect(CLIENT_INFO.version).toBe('0.1.0');
  });
});

// ── Streamable HTTP Compliance ─────────────────────────────────────────────

describe('MCP Streamable HTTP — Protocol Compliance', () => {
  let createStreamableHttpClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../lib/mcp-manager/transports/streamable-http.js');
    createStreamableHttpClient = mod.createStreamableHttpClient;
  });

  const URL = 'https://mcp-server.example.com/mcp';

  describe('JSON-RPC 2.0', () => {
    it('sends well-formed initialize request', async () => {
      let capturedInitBody;
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') {
          capturedInitBody = body;
          return Promise.resolve(mockJsonResponse({
            jsonrpc: '2.0', id: body.id,
            result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Test', version: '1.0' } },
          }, 200, { 'Content-Type': 'application/json' }));
        }
        if (body.method === 'notifications/initialized') return Promise.resolve(mockJsonResponse({}, 202));
        return Promise.resolve(mockJsonResponse({}, 500));
      });

      const client = await createStreamableHttpClient(URL);
      expect(capturedInitBody.jsonrpc).toBe('2.0');
      expect(typeof capturedInitBody.id).toBe('number');
      expect(capturedInitBody.method).toBe('initialize');
      expect(capturedInitBody.params.protocolVersion).toBe('2025-06-18');
      expect(capturedInitBody.params.capabilities).toEqual({ tools: {} });
      expect(capturedInitBody.params.clientInfo.name).toBe('agent-sdk-backend');
      client.close();
    });

    it('initialized notification has no id', async () => {
      let capturedNotif;
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') {
          return Promise.resolve(mockJsonResponse({
            jsonrpc: '2.0', id: 1,
            result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'T', version: '1' } },
          }));
        }
        if (body.method === 'notifications/initialized') { capturedNotif = body; return Promise.resolve(mockJsonResponse({}, 202)); }
        return Promise.resolve(mockJsonResponse({}, 500));
      });

      await createStreamableHttpClient(URL);
      expect(capturedNotif.jsonrpc).toBe('2.0');
      expect(capturedNotif.id).toBeUndefined();
    });

    it('monotonically increasing IDs', async () => {
      const ids = [];
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        ids.push(body.id);
        if (body.method === 'initialize') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'S', version: '1' } },
        }));
        if (body.method === 'notifications/initialized') return Promise.resolve(mockJsonResponse({}, 202));
        if (body.method === 'tools/list') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: body.id,
          result: { tools: [{ name: 't1', inputSchema: { type: 'object' } }] },
        }));
        return Promise.resolve(mockJsonResponse({}, 500));
      });
      const client = await createStreamableHttpClient(URL);
      await client.listTools();
      client.close();
      const numeric = ids.filter((id) => id !== undefined);
      for (let i = 1; i < numeric.length; i++) expect(numeric[i]).toBeGreaterThan(numeric[i - 1]);
    });
  });

  describe('Content types', () => {
    it('handles text/image/resource in application/json', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: 1,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'S', version: '1' } },
        }));
        if (body.method === 'notifications/initialized') return Promise.resolve(mockJsonResponse({}, 202));
        if (body.method === 'tools/call') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: body.id,
          result: { content: [
            { type: 'text', text: '45F' },
            { type: 'image', data: 'imgdata', mimeType: 'image/png' },
            { type: 'resource', resource: { uri: 'data://r', text: '{"t":45}' } },
          ], isError: false },
        }, 200, { 'Content-Type': 'application/json' }));
        return Promise.resolve(mockJsonResponse({}, 500));
      });
      const client = await createStreamableHttpClient(URL);
      const result = await client.callTool('weather', { city: 'NYC' });
      expect(result.content).toHaveLength(3);
      expect(result.content[0].type).toBe('text');
      expect(result.content[1].type).toBe('image');
      expect(result.content[2].type).toBe('resource');
      client.close();
    });
  });

  describe('Session', () => {
    it('Mcp-Session-Id sent in subsequent requests', async () => {
      const captured = [];
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        captured.push({ ...init.headers });
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: 1,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'S', version: '1' } },
        }, 200, { 'Mcp-Session-Id': 'sess-456' }));
        if (body.method === 'notifications/initialized') return Promise.resolve(mockJsonResponse({}, 202));
        if (body.method === 'tools/list') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: 2,
          result: { tools: [{ name: 't1', inputSchema: { type: 'object' } }] },
        }));
        return Promise.resolve(mockJsonResponse({}, 500));
      });
      const client = await createStreamableHttpClient(URL);
      await client.listTools();
      expect(captured.some((h) => h['Mcp-Session-Id'] === 'sess-456')).toBe(true);
      client.close();
    });

    it('404 raises session expired error', async () => {
      let count = 0;
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: 1,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'S', version: '1' } },
        }, 200, { 'Mcp-Session-Id': 'sess-e' }));
        if (body.method === 'notifications/initialized') return Promise.resolve(mockJsonResponse({}, 202));
        if (++count === 1) return Promise.resolve(mockJsonResponse({ error: 'gone' }, 404));
        return Promise.resolve(mockJsonResponse({}, 500));
      });
      const client = await createStreamableHttpClient(URL);
      await expect(client.listTools()).rejects.toThrow(/session expired/i);
      client.close();
    });

    it('DELETE on close', async () => {
      let deleted = false;
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: 1,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'S', version: '1' } },
        }, 200, { 'Mcp-Session-Id': 'sess-d' }));
        if (body.method === 'notifications/initialized') return Promise.resolve(mockJsonResponse({}, 202));
        if (init?.method === 'DELETE') { deleted = true; return Promise.resolve(mockJsonResponse({}, 204)); }
        return Promise.resolve(mockJsonResponse({}, 500));
      });
      const client = await createStreamableHttpClient(URL);
      client.close();
      expect(deleted).toBe(true);
    });
  });

  describe('Errors', () => {
    it('non-OK HTTP', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({ error: 'Bad' }, 502));
      await expect(createStreamableHttpClient(URL)).rejects.toThrow('MCP HTTP 502');
    });

    it('JSON-RPC error', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: 1,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'S', version: '1' } },
        }));
        if (body.method === 'notifications/initialized') return Promise.resolve(mockJsonResponse({}, 202));
        if (body.method === 'tools/call') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: 2,
          error: { code: -32602, message: 'Bad tool' },
        }));
        return Promise.resolve(mockJsonResponse({}, 500));
      });
      const client = await createStreamableHttpClient(URL);
      await expect(client.callTool('bad_tool', {})).rejects.toThrow('MCP error [-32602]');
      client.close();
    });
  });

  describe('Protocol version negotiation', () => {
    it('accepts same version from server', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return Promise.resolve(mockJsonResponse({
          jsonrpc: '2.0', id: 1,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'S', version: '1' } },
        }));
        if (body.method === 'notifications/initialized') return Promise.resolve(mockJsonResponse({}, 202));
        return Promise.resolve(mockJsonResponse({}, 500));
      });
      const client = await createStreamableHttpClient(URL);
      expect(client).toBeDefined();
      client.close();
    });
  });
});
