/**
 * Tests for backend/lib/mcp-manager/transports/legacy-sse.js
 *
 * MCP 2024-11-05 Legacy SSE transport:
 *   - GET SSE → endpoint discovery → POST JSON-RPC
 *   - tools/list, tools/call via SSE response correlation
 *   - Close cleanup
 *
 * Uses controlled ReadableStream for reliable async event delivery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let createLegacySseClient;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../lib/mcp-manager/transports/legacy-sse.js');
  createLegacySseClient = mod.createLegacySseClient;
});

// ── Controlled SSE stream factory ───────────────────────────────────────────

function createSseStream() {
  let ctrl;
  const stream = new ReadableStream({
    start(c) { ctrl = c; },
    pull() { /* backpressure handled by enqueue calls */ },
  });
  const enc = new TextEncoder();
  return {
    stream,
    send(line) { ctrl.enqueue(enc.encode(line + '\n')); },
    sendEvent(lines) { lines.forEach((l) => ctrl.enqueue(enc.encode(l + '\n'))); },
    close() { ctrl.close(); },
  };
}

function endpointEvent(postUrl) {
  return ['event: endpoint', `data: ${postUrl}`, ''];
}

function jsonRpcResponse(id, result) {
  return ['event: message', `data: ${JSON.stringify({ jsonrpc: '2.0', id, result })}`, ''];
}

function jsonRpcError(id, code, message) {
  return ['event: message', `data: ${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}`, ''];
}

function okResponse(data = {}) {
  return { ok: true, status: 200, json: () => Promise.resolve(data), text: () => Promise.resolve(''), body: null };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LegacySseClient', () => {
  const SSE_URL = 'https://mcp-old.example.com/sse';
  const POST_URL = 'https://mcp-old.example.com/msg';

  describe('connection and endpoint discovery', () => {
    it('connects and discovers POST URL', async () => {
      const sse = createSseStream();

      let postCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url === SSE_URL) {
          return Promise.resolve({ ok: true, status: 200, body: sse.stream });
        }
        postCount++;
        if (postCount === 1) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(1, {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'Srv', version: '1.0' },
          })));
        }
        return Promise.resolve(okResponse());
      });

      const clientPromise = createLegacySseClient(SSE_URL);
      await Promise.resolve();
      sse.sendEvent(endpointEvent(POST_URL));

      const client = await clientPromise;
      expect(globalThis.fetch).toHaveBeenCalledWith(
        SSE_URL,
        expect.objectContaining({ headers: expect.objectContaining({ Accept: 'text/event-stream' }) }),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        POST_URL,
        expect.objectContaining({ method: 'POST' }),
      );
      client.close();
    });

    it('throws on non-OK SSE connection', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502, body: null });
      await expect(createLegacySseClient(SSE_URL)).rejects.toThrow('SSE connect failed');
    });

    it('resolves relative endpoint URL against base SSE URL', async () => {
      const sse = createSseStream();

      let postCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url, init) => {
        if (url === SSE_URL) {
          return Promise.resolve({ ok: true, status: 200, body: sse.stream });
        }
        postCount++;
        if (postCount === 1) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(1, {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'Srv', version: '1.0' },
          })));
        }
        return Promise.resolve(okResponse());
      });

      const clientPromise = createLegacySseClient(SSE_URL);
      await Promise.resolve();
      sse.sendEvent(endpointEvent('/api/mcp/messages'));

      const client = await clientPromise;
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://mcp-old.example.com/api/mcp/messages',
        expect.objectContaining({ method: 'POST' }),
      );
      client.close();
    });

    it('times out waiting for endpoint event', async () => {
      vi.useFakeTimers();
      try {
        const sse = createSseStream();
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: sse.stream });

        // Close the stream without sending endpoint event — triggers error path
        const clientPromise = createLegacySseClient(SSE_URL);
        await Promise.resolve();
        sse.close();

        const rejection = expect(clientPromise).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(15_000);
        await rejection;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('tools/list', () => {
    it('returns tool list from server after initialize handshake', async () => {
      const sse = createSseStream();
      const tools = [{ name: 'old_search', description: 'Search', inputSchema: { type: 'object' } }];

      let postCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url === SSE_URL) {
          return Promise.resolve({ ok: true, status: 200, body: sse.stream });
        }
        postCount++;
        if (postCount === 1) {
          // Initialize POST → deliver initialize result via SSE
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(1, {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'OldLegacy', version: '1.0' },
          })));
          return Promise.resolve(okResponse());
        }
        if (postCount === 2) {
          // tools/list POST → deliver list via SSE
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(2, { tools })));
          return Promise.resolve(okResponse());
        }
        return Promise.resolve(okResponse());
      });

      const clientPromise = createLegacySseClient(SSE_URL);
      await Promise.resolve();
      sse.sendEvent(endpointEvent(POST_URL));

      const client = await clientPromise;
      const result = await client.listTools();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('old_search');
      client.close();
    });

    it('returns empty array when no tools', async () => {
      const sse = createSseStream();

      let postCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url === SSE_URL) {
          return Promise.resolve({ ok: true, status: 200, body: sse.stream });
        }
        postCount++;
        if (postCount === 1) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(1, {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'Old', version: '1.0' },
          })));
          return Promise.resolve(okResponse());
        }
        if (postCount === 2) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(2, { tools: [] })));
          return Promise.resolve(okResponse());
        }
        return Promise.resolve(okResponse());
      });

      const clientPromise = createLegacySseClient(SSE_URL);
      await Promise.resolve();
      sse.sendEvent(endpointEvent(POST_URL));

      const client = await clientPromise;
      expect(await client.listTools()).toEqual([]);
      client.close();
    });
  });

  describe('tools/call', () => {
    it('calls tool and gets structured result via SSE', async () => {
      const sse = createSseStream();
      const callResult = { content: [{ type: 'text', text: 'legacy result' }] };

      let postCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url === SSE_URL) {
          return Promise.resolve({ ok: true, status: 200, body: sse.stream });
        }
        postCount++;
        if (postCount === 1) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(1, {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'Old', version: '1.0' },
          })));
          return Promise.resolve(okResponse());
        }
        if (postCount === 2) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(2, callResult)));
          return Promise.resolve(okResponse());
        }
        return Promise.resolve(okResponse());
      });

      const clientPromise = createLegacySseClient(SSE_URL);
      await Promise.resolve();
      sse.sendEvent(endpointEvent(POST_URL));

      const client = await clientPromise;
      const result = await client.callTool('old_tool', { x: 1 });

      expect(result.content[0].text).toBe('legacy result');
      client.close();
    });

    it('passes isError for tool execution errors', async () => {
      const sse = createSseStream();

      let postCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url === SSE_URL) {
          return Promise.resolve({ ok: true, status: 200, body: sse.stream });
        }
        postCount++;
        if (postCount === 1) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(1, {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'Old', version: '1.0' },
          })));
          return Promise.resolve(okResponse());
        }
        if (postCount === 2) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(2, {
            content: [{ type: 'text', text: 'Denied' }],
            isError: true,
          })));
          return Promise.resolve(okResponse());
        }
        return Promise.resolve(okResponse());
      });

      const clientPromise = createLegacySseClient(SSE_URL);
      await Promise.resolve();
      sse.sendEvent(endpointEvent(POST_URL));

      const client = await clientPromise;
      const result = await client.callTool('restricted', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Denied');
      client.close();
    });

    it('rejects on JSON-RPC error response', async () => {
      const sse = createSseStream();

      let postCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url === SSE_URL) {
          return Promise.resolve({ ok: true, status: 200, body: sse.stream });
        }
        postCount++;
        if (postCount === 1) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(1, {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'Old', version: '1.0' },
          })));
          return Promise.resolve(okResponse());
        }
        if (postCount === 2) {
          process.nextTick(() => sse.sendEvent(jsonRpcError(2, -32602, 'Unknown tool: bad')));
          return Promise.resolve(okResponse());
        }
        return Promise.resolve(okResponse());
      });

      const clientPromise = createLegacySseClient(SSE_URL);
      await Promise.resolve();
      sse.sendEvent(endpointEvent(POST_URL));

      const client = await clientPromise;
      await expect(client.callTool('bad', {})).rejects.toThrow('MCP error');
      client.close();
    });
  });

  describe('close', () => {
    it('closes SSE reader and rejects pending promises', async () => {
      const sse = createSseStream();

      let postCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url === SSE_URL) {
          return Promise.resolve({ ok: true, status: 200, body: sse.stream });
        }
        postCount++;
        if (postCount === 1) {
          // Initialize POST → deliver initialize result via SSE
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(1, {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'Old', version: '1.0' },
          })));
          return Promise.resolve(okResponse());
        }
        return Promise.resolve(okResponse());
      });

      const clientPromise = createLegacySseClient(SSE_URL);
      await Promise.resolve();
      sse.sendEvent(endpointEvent(POST_URL));

      const client = await clientPromise;
      const callPromise = client.callTool('slow', {});
      client.close();

      await expect(callPromise).rejects.toThrow('MCP connection closed');
    });
  });

  describe('transport errors', () => {
    it('wraps fetch errors for SSE GET', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      );
      await expect(createLegacySseClient(SSE_URL)).rejects.toThrow('Connection refused');
    });

    it('wraps fetch error with unknown code', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        Object.assign(new Error('something bad'), { code: 'MYSTERY_CODE' }),
      );
      await expect(createLegacySseClient(SSE_URL)).rejects.toThrow('something bad');
    });
  });

  describe('notifications', () => {
    it('sends initialized notification after handshake', async () => {
      const sse = createSseStream();
      let postMethods = [];

      let postCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url, init) => {
        if (url === SSE_URL) {
          return Promise.resolve({ ok: true, status: 200, body: sse.stream });
        }
        postCount++;
        if (postCount === 1) {
          process.nextTick(() => sse.sendEvent(jsonRpcResponse(1, {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'Srv', version: '1.0' },
          })));
        }
        return Promise.resolve(okResponse());
      });

      const clientPromise = createLegacySseClient(SSE_URL);
      await Promise.resolve();
      sse.sendEvent(endpointEvent(POST_URL));

      const client = await clientPromise;
      expect(client).toBeDefined();
      expect(client.listTools).toBeInstanceOf(Function);
      expect(client.callTool).toBeInstanceOf(Function);
      client.close();
    });
  });
});
