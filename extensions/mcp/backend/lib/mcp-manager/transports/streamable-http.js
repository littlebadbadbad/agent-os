/**
 * MCP Streamable HTTP transport (MCP 2025-03-26).
 *
 * Single HTTP endpoint supporting both POST (client→server) and GET (server→client).
 *
 * Key protocol behaviors:
 *  - Initialize → send `initialize` request → receive `InitializeResult` with
 *    optional `Mcp-Session-Id` header.
 *  - Send `notifications/initialized` notification.
 *  - Subsequent requests include `Mcp-Session-Id` header.
 *  - POST responses may be `application/json` (single response) or
 *    `text/event-stream` (SSE stream).
 *  - GET opens an SSE stream for server-to-client push messages
 *    (e.g. `notifications/tools/list_changed`).
 *  - HTTP DELETE terminates the session.
 *
 * Proxy support: when `useProxy` is enabled and the target is not local/private,
 * connections route through the configured proxy.
 */

import {
  CLIENT_INFO,
  MCP_PROTOCOL_VERSION,
  shouldUseProxy,
  ensureProxyFetch,
  wrapTransportError,
} from './utils.js';

/**
 * @typedef {import('./utils.js').ProxyConfig} ProxyConfig
 * @typedef {import('./utils.js').ToolCallResult} ToolCallResult
 */

/**
 * @typedef {object} McpHttpClient
 * @property {() => Promise<readonly ToolDef[]>} listTools
 * @property {(name:string, args:Record<string,unknown>) => Promise<ToolCallResult>} callTool
 * @property {() => void} close
 * @property {() => AsyncIterable<{method:string, params:unknown}>} listen - GET SSE stream
 */

/**
 * @typedef {object} ToolDef
 * @property {string} name
 * @property {string} [description]
 * @property {object} inputSchema
 */

/**
 * Create an MCP Streamable HTTP client.
 *
 * @param {string} url - MCP endpoint URL (single endpoint for POST + GET).
 * @param {Record<string,string>} [extraHeaders]
 * @param {{useProxy?:boolean, proxyConfig?:ProxyConfig|null}} [options]
 * @returns {Promise<McpHttpClient>}
 */
export async function createStreamableHttpClient(url, extraHeaders = {}, { useProxy = false, proxyConfig = null } = {}) {
  let requestId = 0;
  /** @type {string|undefined} */
  let sessionId;
  let closed = false;

  // ── Fetch selection ────────────────────────────────────────────────────
  const _useProxy = shouldUseProxy(url, useProxy, proxyConfig);
  const requestFetch = _useProxy
    ? await ensureProxyFetch(proxyConfig)
    : globalThis.fetch.bind(globalThis);

  // ── Helpers ────────────────────────────────────────────────────────────

  function buildHeaders() {
    /** @type {Record<string,string>} */
    const h = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extraHeaders,
    };
    if (sessionId) h['Mcp-Session-Id'] = sessionId;
    return h;
  }

  /**
   * Send a JSON-RPC request and return the result.
   * @param {string} method
   * @param {Record<string,unknown>} [params]
   * @returns {Promise<unknown>}
   */
  async function sendRequest(method, params = {}) {
    if (closed) throw new Error('MCP connection closed');

    const id = ++requestId;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    /** @type {Response} */
    let res;
    try {
      res = await requestFetch(url, { method: 'POST', headers: buildHeaders(), body });
    } catch (err) {
      throw wrapTransportError(/** @type {Error} */ (err), url);
    }

    // Session expired or invalid — clear session and let caller retry
    if (res.status === 404 && sessionId) {
      sessionId = undefined;
      throw new Error('MCP session expired — please reconnect.');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MCP HTTP ${res.status}: ${text}`);
    }

    // Capture session ID from response
    const newSession = res.headers.get('Mcp-Session-Id');
    if (newSession) sessionId = newSession;

    const contentType = res.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return extractFirstSseResult(res);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`MCP error [${data.error.code}]: ${data.error.message}`);
    }
    return data.result;
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   * @param {string} method
   * @param {Record<string,unknown>} [params]
   */
  function sendNotification(method, params = {}) {
    if (closed) return;
    requestFetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    }).catch(() => {});
  }

  // ── Initialize handshake ───────────────────────────────────────────────
  const initResult = await sendRequest('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: CLIENT_INFO,
  });

  // Negotiate protocol version
  if (initResult && typeof initResult === 'object' && 'protocolVersion' in initResult) {
    const serverVersion = /** @type {{protocolVersion:string}} */ (initResult).protocolVersion;
    if (serverVersion !== MCP_PROTOCOL_VERSION) {
      console.warn(`[mcp] Server protocol version ${serverVersion} differs from client ${MCP_PROTOCOL_VERSION}`);
    }
  }

  sendNotification('notifications/initialized');

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    /** List available tools from this server. */
    async listTools() {
      const result = await sendRequest('tools/list');
      return (result && typeof result === 'object' && 'tools' in result)
        ? /** @type {{tools:readonly ToolDef[]}} */ (result).tools
        : [];
    },

    /** Call a tool on this server. Returns structured ToolCallResult. */
    async callTool(name, args) {
      const result = await sendRequest('tools/call', { name, arguments: args });
      // The result is already a ToolCallResult from the MCP server
      return /** @type {ToolCallResult} */ (result);
    },

    /** Open a GET SSE stream for server→client push messages. */
    async *listen() {
      if (closed) return;

      /** @type {Response} */
      let res;
      try {
        res = await requestFetch(url, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
            ...extraHeaders,
          },
        });
      } catch (err) {
        throw wrapTransportError(/** @type {Error} */ (err), url);
      }

      if (res.status === 405) {
        // Server doesn't support GET — this is optional per spec
        return;
      }
      if (!res.ok) {
        throw new Error(`MCP GET stream failed: HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let eventType = '';
      let dataLines = '';

      try {
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines += (dataLines ? '\n' : '') + line.slice(5);
            } else if (line === '' && dataLines) {
              try {
                const msg = JSON.parse(dataLines);
                yield { method: msg.method ?? eventType, params: msg.params };
              } catch { /* ignore unparseable events */ }
              eventType = '';
              dataLines = '';
            }
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    },

    /** Clean shutdown: send DELETE and close. */
    close() {
      closed = true;
      if (sessionId) {
        requestFetch(url, {
          method: 'DELETE',
          headers: { 'Mcp-Session-Id': sessionId, ...extraHeaders },
        }).catch(() => {});
        sessionId = undefined;
      }
    },
  };
}

// ── SSE result extraction (for POST responses that stream) ──────────────

/**
 * Extract the first SSE result event from a POST response body.
 * @param {Response} res
 * @returns {Promise<unknown>}
 */
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
