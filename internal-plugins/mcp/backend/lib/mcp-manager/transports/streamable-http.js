/**
 * MCP Streamable HTTP transport (MCP 2025-06-18, negotiable down to 2025-03-26).
 *
 * Single HTTP endpoint supporting both POST (client→server) and GET (server→client).
 *
 * Key protocol behaviors:
 *  - Initialize → send `initialize` request → receive `InitializeResult` with
 *    optional `Mcp-Session-Id` header. The server's negotiated protocol
 *    version is then echoed back via `MCP-Protocol-Version` on every
 *    subsequent request.
 *  - Send `notifications/initialized` notification.
 *  - Subsequent requests include `Mcp-Session-Id` header.
 *  - POST responses may be `application/json` (single response) or
 *    `text/event-stream` (SSE stream — matched by JSON-RPC id, ignoring
 *    unrelated notifications/requests the server may interleave).
 *  - GET opens an SSE stream for server-to-client push messages
 *    (e.g. `notifications/tools/list_changed`).
 *  - HTTP DELETE terminates the session.
 *  - `tools/list` follows cursor-based pagination to completion.
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
  negotiateProtocolVersion,
  parseSseFrames,
  paginateList,
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
  /** Protocol version negotiated with the server during `initialize`. */
  let negotiatedVersion = '';
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
    // Per spec, every request AFTER `initialize` must carry the negotiated
    // protocol version so the server can respond in kind.
    if (negotiatedVersion) h['MCP-Protocol-Version'] = negotiatedVersion;
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
      return extractSseResult(res, id);
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

  negotiatedVersion = negotiateProtocolVersion(initResult);
  if (negotiatedVersion !== MCP_PROTOCOL_VERSION) {
    console.warn(`[mcp] Server protocol version ${negotiatedVersion} differs from client ${MCP_PROTOCOL_VERSION}`);
  }

  sendNotification('notifications/initialized');

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    /** List available tools from this server, following pagination to completion. */
    async listTools() {
      return paginateList(sendRequest, 'tools/list', 'tools');
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
        res = await requestFetch(url, { method: 'GET', headers: buildHeaders() });
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

      try {
        for await (const frame of parseSseFrames(reader)) {
          if (closed) break;
          try {
            const msg = JSON.parse(frame.data);
            yield { method: msg.method ?? frame.event, params: msg.params };
          } catch { /* ignore unparseable events */ }
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
          headers: buildHeaders(),
        }).catch(() => {});
        sessionId = undefined;
      }
    },
  };
}

// ── SSE result extraction (for POST responses that stream) ──────────────

/**
 * Extract the JSON-RPC response matching `expectedId` from a POST
 * response's SSE body.
 *
 * Per spec, the server MAY send other requests/notifications (e.g.
 * progress updates) on this stream before the actual response — those
 * MUST be skipped rather than mistaken for the final result.
 *
 * @param {Response} res
 * @param {number} expectedId
 * @returns {Promise<unknown>}
 */
async function extractSseResult(res, expectedId) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('MCP: empty response body');

  try {
    for await (const frame of parseSseFrames(reader)) {
      let msg;
      try {
        msg = JSON.parse(frame.data);
      } catch {
        continue; // Not JSON — e.g. a malformed/unrelated event; skip it.
      }
      const isMatchingResponse = msg.id === expectedId && ('result' in msg || 'error' in msg);
      if (!isMatchingResponse) continue; // Unrelated notification/request — ignore and keep reading.
      if (msg.error) throw new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`);
      return msg.result;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new Error('MCP: SSE stream ended without a result');
}

