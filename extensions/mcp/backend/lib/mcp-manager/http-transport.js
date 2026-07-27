/**
 * MCP HTTP transport (MCP spec 2025-03-26).
 *
 * Each request is a JSON-RPC POST.  The server may respond with either:
 *   - application/json        — single JSON-RPC response
 *   - text/event-stream       — SSE stream; we read the first result event
 *
 * Sessions are tracked via the Mcp-Session-Id response header.
 *
 * Proxy support:
 *   When `useProxy` is true and a `proxyConfig` is provided, all connections
 *   route through the configured proxy.  When false, the default Node.js
 *   fetch is used (direct connection).
 */

import { CLIENT_INFO, serializeToolResult } from './transport-utils.js';

// ── Proxy fetch (lazily initialised) ──────────────────────────────────────────

/**
 * Lazily creates an undici ProxyAgent + fetch that routes through the
 * configured proxy.  The Agent is created once and reused (connection pooling).
 */
let _proxyFetchCache = null;
async function ensureProxyFetch(proxyConfig) {
  if (!_proxyFetchCache) {
    const { fetch: undiciFetch, ProxyAgent } = await import('undici');
    const proxyUri = `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`;
    const agent = new ProxyAgent({ uri: proxyUri, connectTimeout: proxyConfig.connectTimeout ?? 10_000 });
    _proxyFetchCache = (input, init) => undiciFetch(input, { ...init, dispatcher: agent });
  }
  return _proxyFetchCache;
}

/**
 * @param {string} url
 * @param {Record<string,string>} [extraHeaders]
 * @param {{ useProxy?: boolean, proxyConfig?: object }} [options]
 */
export async function createHttpClient(url, extraHeaders = {}, { useProxy = true, proxyConfig } = {}) {
  let requestId = 0;
  let sessionId;

  // Select fetch function once: proxy-aware fetch, or default Node.js fetch.
  const requestFetch = useProxy && proxyConfig
    ? await ensureProxyFetch(proxyConfig)
    : globalThis.fetch.bind(globalThis);

  function buildHeaders() {
    const h = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extraHeaders,
    };
    if (sessionId) h['Mcp-Session-Id'] = sessionId;
    return h;
  }

  async function sendRequest(method, params) {
    const id = ++requestId;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const res = await requestFetch(url, { method: 'POST', headers: buildHeaders(), body });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MCP HTTP ${res.status}: ${text}`);
    }

    const newSession = res.headers.get('Mcp-Session-Id');
    if (newSession) sessionId = newSession;

    const contentType = res.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return extractFirstSseResult(res);
    }

    const data = await res.json();
    if (data.error) throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`);
    return data.result;
  }

  function sendNotification(method, params) {
    requestFetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    }).catch(() => {});
  }

  // Handshake
  await sendRequest('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {} },
    clientInfo: CLIENT_INFO,
  });
  sendNotification('notifications/initialized');

  return {
    async listTools() {
      const result = await sendRequest('tools/list');
      return result.tools ?? [];
    },
    async callTool(name, args) {
      const result = await sendRequest('tools/call', { name, arguments: args });
      return serializeToolResult(result);
    },
    close() {
      if (sessionId) {
        requestFetch(url, { method: 'DELETE', headers: buildHeaders() }).catch(() => {});
        sessionId = undefined;
      }
    },
  };
}

async function extractFirstSseResult(res) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('MCP: empty response body');
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      let dataLines = '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          dataLines += line.slice(6);
        } else if (line === '' && dataLines) {
          const msg = JSON.parse(dataLines);
          reader.cancel().catch(() => {});
          if (msg.error) throw new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`);
          return msg.result;
        } else if (!line.startsWith(':') && !line.startsWith('event:') &&
                   !line.startsWith('id:') && !line.startsWith('retry:')) {
          dataLines = '';
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new Error('MCP: SSE stream ended without a result');
}
