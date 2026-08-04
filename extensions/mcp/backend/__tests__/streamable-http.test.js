/**
 * Tests for backend/lib/mcp-manager/transports/streamable-http.js
 *
 * MCP 2025-03-26 Streamable HTTP:
 *   - Initialize handshake (POST → InitializeResult + Mcp-Session-Id)
 *   - Initialized notification
 *   - tools/list, tools/call
 *   - Session ID propagation
 *   - SSE response extraction from POST
 *   - GET SSE stream (server→client push)
 *   - DELETE on close (session termination)
 *   - 404 → session expired error
 *   - Error handling (HTTP errors, transport errors)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// ── Mock undici (lazy-loaded by ensureProxyFetch) ────────────────────────────
vi.mock('undici', () => ({
  fetch: vi.fn(),
  ProxyAgent: vi.fn(),
}));

let createStreamableHttpClient;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../lib/mcp-manager/transports/streamable-http.js');
  createStreamableHttpClient = mod.createStreamableHttpClient;
});

// ── Mock fetch helpers ────────────────────────────────────────────────────────

function mockFetch(responseFactory) {
  globalThis.fetch = vi.fn().mockImplementation((url, init) => {
    return Promise.resolve(responseFactory(url, init));
  });
}

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

function mockSseResponse(lines, status = 200, headers = {}) {
  const encoder = new TextEncoder();
  const data = encoder.encode(lines.join('\n') + '\n');
  const nodeStream = Readable.from([data]);
  const readable = Readable.toWeb(nodeStream);

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'Content-Type': 'text/event-stream', ...headers }),
    json: () => Promise.reject(new Error('Not JSON')),
    text: () => Promise.resolve(lines.join('\n')),
    body: readable,
  };
}

function mockInitResponse(sessionId) {
  return mockJsonResponse(
    {
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'TestServer', version: '1.0.0' },
      },
    },
    200,
    sessionId ? { 'Mcp-Session-Id': sessionId } : {},
  );
}

function mockToolsList(tools) {
  return mockJsonResponse({
    jsonrpc: '2.0',
    id: expect.any(Number),
    result: { tools },
  });
}

function mockToolCallResult(content) {
  return mockJsonResponse({
    jsonrpc: '2.0',
    id: expect.any(Number),
    result: { content },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StreamableHttpClient', () => {
  const URL = 'https://mcp.example.com/mcp';

  describe('lifecycle: initialize → initialized', () => {
    it('sends initialize and initialized notification', async () => {
      const calls = [];
      mockFetch((_url, init) => {
        calls.push(init);
        const body = JSON.parse(init.body || '{}');

        if (body.method === 'initialize') {
          return mockInitResponse('session-abc-123');
        }
        if (body.method === 'notifications/initialized') {
          return mockJsonResponse({}, 202); // 202 Accepted for notifications
        }
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);

      // Verify initialize was called
      const initCall = calls.find((c) => {
        try { return JSON.parse(c.body).method === 'initialize'; } catch { return false; }
      });
      expect(initCall).toBeDefined();
      const initBody = JSON.parse(initCall.body);
      expect(initBody.params.protocolVersion).toBe('2025-06-18');
      expect(initBody.params.clientInfo.name).toBe('agent-sdk-backend');

      // Verify initialized notification was sent
      const notifCall = calls.find((c) => {
        try { return JSON.parse(c.body).method === 'notifications/initialized'; } catch { return false; }
      });
      expect(notifCall).toBeDefined();

      client.close();
    });

    it('sends Mcp-Session-Id in subsequent requests', async () => {
      const capturedHeaders = [];
      mockFetch((_url, init) => {
        capturedHeaders.push({ ...init.headers });
        const body = JSON.parse(init.body || '{}');

        if (body.method === 'initialize') {
          return mockInitResponse('sess-456');
        }
        if (body.method === 'notifications/initialized') {
          return mockJsonResponse({}, 202);
        }
        if (body.method === 'tools/list') {
          return mockToolsList([{ name: 't1', inputSchema: { type: 'object' } }]);
        }
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      await client.listTools();

      // At least one request after initialize should have the session ID
      const hasSessionHeader = capturedHeaders.some((h) => h['Mcp-Session-Id'] === 'sess-456');
      expect(hasSessionHeader).toBe(true);

      client.close();
    });

    it('sends MCP-Protocol-Version on requests after initialize (not on initialize itself)', async () => {
      const capturedHeaders = [];
      mockFetch((_url, init) => {
        capturedHeaders.push({ ...init.headers });
        const body = JSON.parse(init.body || '{}');

        if (body.method === 'initialize') {
          return mockInitResponse('sess-789');
        }
        if (body.method === 'notifications/initialized') {
          return mockJsonResponse({}, 202);
        }
        if (body.method === 'tools/list') {
          return mockToolsList([{ name: 't1', inputSchema: { type: 'object' } }]);
        }
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      expect(capturedHeaders[0]['MCP-Protocol-Version']).toBeUndefined();

      await client.listTools();
      const listCallHeaders = capturedHeaders[capturedHeaders.length - 1];
      expect(listCallHeaders['MCP-Protocol-Version']).toBe('2025-03-26');

      client.close();
    });
  });

  describe('tools/list', () => {
    it('returns tool list from server', async () => {
      const tools = [
        { name: 'search', description: 'Search', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
        { name: 'create', description: 'Create', inputSchema: { type: 'object' } },
      ];

      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/list') return mockToolsList(tools);
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      const result = await client.listTools();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('search');
      expect(result[1].name).toBe('create');
      client.close();
    });

    it('returns empty array when no tools', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/list') return mockToolsList([]);
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      const result = await client.listTools();
      expect(result).toEqual([]);
      client.close();
    });

    it('returns empty array when response has no tools field', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/list') return mockJsonResponse({ jsonrpc: '2.0', id: 2, result: {} });
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      const result = await client.listTools();
      expect(result).toEqual([]);
      client.close();
    });

    it('follows nextCursor pagination across multiple pages', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/list') {
          if (!body.params?.cursor) {
            return mockJsonResponse({
              jsonrpc: '2.0', id: body.id,
              result: { tools: [{ name: 'page1', inputSchema: { type: 'object' } }], nextCursor: 'page2' },
            });
          }
          return mockJsonResponse({
            jsonrpc: '2.0', id: body.id,
            result: { tools: [{ name: 'page2', inputSchema: { type: 'object' } }] },
          });
        }
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      const result = await client.listTools();
      expect(result.map((t) => t.name)).toEqual(['page1', 'page2']);
      client.close();
    });
  });

  describe('tools/call', () => {
    it('calls a tool and returns structured result', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/call') {
          return mockToolCallResult([{ type: 'text', text: 'Result: 42' }]);
        }
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      const result = await client.callTool('compute', { x: 1, y: 2 });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Result: 42');

      client.close();
    });

    it('returns isError: true for error results', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/call') {
          return mockJsonResponse({
            jsonrpc: '2.0',
            id: expect.any(Number),
            result: { content: [{ type: 'text', text: 'Not found' }], isError: true },
          });
        }
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      const result = await client.callTool('bad', {});
      expect(result.isError).toBe(true);
      client.close();
    });
  });

  describe('HTTP error handling', () => {
    it('throws on non-OK HTTP response', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockJsonResponse({ error: 'Bad gateway' }, 502);
        return mockJsonResponse({}, 500);
      });

      await expect(createStreamableHttpClient(URL)).rejects.toThrow('MCP HTTP 502');
    });

    it('throws on JSON-RPC error response', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/call') {
          return mockJsonResponse({
            jsonrpc: '2.0',
            id: expect.any(Number),
            error: { code: -32602, message: 'Unknown tool: bad_tool' },
          });
        }
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      await expect(client.callTool('bad_tool', {})).rejects.toThrow('MCP error [-32602]');
      client.close();
    });

    it('throws on session expired (404 with session ID)', async () => {
      let callCount = 0;
      mockFetch((_url, init) => {
        callCount++;
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize' && callCount === 1) return mockInitResponse('old-session');
        if (body.method === 'notifications/initialized' && callCount === 2) return mockJsonResponse({}, 202);
        // Simulate session expired
        return { ok: false, status: 404, headers: new Headers(), json: () => Promise.resolve({}), text: () => Promise.resolve('Session not found') };
      });

      const client = await createStreamableHttpClient(URL);
      await expect(client.listTools()).rejects.toThrow('session expired');
      client.close();
    });
  });

  describe('close (session termination)', () => {
    it('sends DELETE on close when session ID exists', async () => {
      const capturedMethods = [];
      mockFetch((_url, init) => {
        capturedMethods.push(init.method);
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('sess-close');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        return mockJsonResponse({}, 200);
      });

      const client = await createStreamableHttpClient(URL);
      client.close();

      expect(capturedMethods).toContain('DELETE');
    });

    it('does not send DELETE if no session was established', async () => {
      const capturedMethods = [];
      mockFetch((_url, init) => {
        capturedMethods.push(init.method);
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse(undefined); // No session ID
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        return mockJsonResponse({}, 200);
      });

      const client = await createStreamableHttpClient(URL);
      client.close();

      expect(capturedMethods).not.toContain('DELETE');
    });
  });

  describe('SSE POST response extraction', () => {
    it('throws if SSE stream ends without result', async () => {
      const sseLines = [': just a comment', ''];

      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/call') return mockSseResponse(sseLines);
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      await expect(client.callTool('empty', {})).rejects.toThrow('SSE stream ended without a result');
      client.close();
    });

    it('skips unrelated notifications before the matching response', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/call') {
          return mockSseResponse([
            'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
            '',
            `data: {"jsonrpc":"2.0","id":${body.id},"result":{"content":[{"type":"text","text":"done"}]}}`,
            '',
          ]);
        }
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      const result = await client.callTool('slow', {});
      expect(result.content[0].text).toBe('done');
      client.close();
    });

    it('throws if SSE body is null', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/call') return {
          ok: true, status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
          json: () => Promise.reject(new Error('not json')),
          text: () => Promise.resolve(''),
          body: null,
        };
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      await expect(client.callTool('nobody', {})).rejects.toThrow('empty response body');
      client.close();
    });
  });

  describe('GET listen stream', () => {
    it('yields server→client messages', async () => {
      const sseLines = [
        'event: tools/list_changed',
        'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
        '',
      ];

      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (init.method === 'GET') return mockSseResponse(sseLines);
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      const messages = [];
      for await (const msg of client.listen()) {
        messages.push(msg);
      }
      expect(messages).toHaveLength(1);
      expect(messages[0].method).toBe('notifications/tools/list_changed');
      client.close();
    });

    it('handles 405 (server does not support GET)', async () => {
      mockFetch((_url, init) => {
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (init.method === 'GET') return { ok: false, status: 405, headers: new Headers(), body: null, json: () => Promise.resolve({}), text: () => Promise.resolve('') };
        return mockJsonResponse({}, 500);
      });

      const client = await createStreamableHttpClient(URL);
      const messages = [];
      for await (const msg of client.listen()) {
        messages.push(msg);
      }
      // Should yield nothing
      expect(messages).toHaveLength(0);
      client.close();
    });
  });

  describe('extra headers', () => {
    it('includes extra headers in all requests', async () => {
      const capturedHeaders = [];
      mockFetch((_url, init) => {
        capturedHeaders.push(init.headers);
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') return mockInitResponse('s1');
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        return mockJsonResponse({}, 200);
      });

      const client = await createStreamableHttpClient(URL, { 'X-Custom': 'value', Authorization: 'Bearer tok' });
      expect(capturedHeaders.length).toBeGreaterThan(0);
      for (const h of capturedHeaders) {
        expect(h['X-Custom']).toBe('value');
        expect(h['Authorization']).toBe('Bearer tok');
      }
      client.close();
    });
  });

  describe('protocol version negotiation', () => {
    it('adopts the server-negotiated version for subsequent headers', async () => {
      const capturedHeaders = [];
      mockFetch((_url, init) => {
        capturedHeaders.push({ ...init.headers });
        const body = JSON.parse(init.body || '{}');
        if (body.method === 'initialize') {
          return mockJsonResponse({
            jsonrpc: '2.0', id: 1,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'OldServer', version: '1.0' },
            },
          }, 200, { 'Mcp-Session-Id': 'old' });
        }
        if (body.method === 'notifications/initialized') return mockJsonResponse({}, 202);
        if (body.method === 'tools/list') return mockToolsList([]);
        return mockJsonResponse({}, 200);
      });

      const client = await createStreamableHttpClient(URL);
      await client.listTools();
      const lastHeaders = capturedHeaders[capturedHeaders.length - 1];
      expect(lastHeaders['MCP-Protocol-Version']).toBe('2025-03-26');
      client.close();
    });
  });
});
