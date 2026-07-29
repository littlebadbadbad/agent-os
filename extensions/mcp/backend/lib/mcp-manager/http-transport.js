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
 *   When `useProxy` is enabled and the target URL is not a local/private address,
 *   connections route through the configured proxy.  Localhost, loopback, and
 *   private-network addresses always bypass the proxy.
 */

import {
  CLIENT_INFO,
  MCP_PROTOCOL_VERSION,
  serializeToolResult,
  shouldUseProxy,
  ensureProxyFetch,
  wrapTransportError,
} from './transport-utils.js';

/**
 * @param {string} url - MCP server URL.
 * @param {Record<string,string>} [extraHeaders] - Additional headers (e.g. auth).
 * @param {{ useProxy?: boolean, proxyConfig?: object }} [options]
 */
export async function createHttpClient(url, extraHeaders = {}, { useProxy = false, proxyConfig } = {}) {
  let requestId = 0;
  let sessionId;

  // ── Fetch selection ────────────────────────────────────────────────────
  const _useProxy = shouldUseProxy(url, useProxy, proxyConfig);
  const requestFetch = _useProxy
    ? await ensureProxyFetch(proxyConfig)
    : globalThis.fetch.bind(globalThis);

  // ── Helpers ────────────────────────────────────────────────────────────
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

    let res;
    try {
      res = await requestFetch(url, { method: 'POST', headers: buildHeaders(), body });
    } catch (err) {
      throw wrapTransportError(err, url);
    }

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

  // ── Handshake ──────────────────────────────────────────────────────────
  await sendRequest('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
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
