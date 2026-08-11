/**
 * MCP Legacy SSE transport (MCP 2024-11-05, deprecated).
 *
 * Opens a long-lived GET SSE stream to receive server-sent results,
 * then POSTs JSON-RPC requests to the endpoint URL advertised by the
 * server's first `endpoint` event. A background read loop correlates
 * responses by JSON-RPC id.
 *
 * This transport is provided for backwards compatibility with older MCP servers.
 * Prefer `streamable-http` for new deployments.
 */

import {
  CLIENT_INFO,
  MCP_PROTOCOL_VERSION,
  shouldUseProxy,
  ensureProxyFetch,
  wrapTransportError,
  parseSseFrames,
  paginateList,
} from './utils.js';

/**
 * @typedef {import('./utils.js').ProxyConfig} ProxyConfig
 * @typedef {import('./utils.js').ToolCallResult} ToolCallResult
 */

/**
 * @typedef {object} ToolDef
 * @property {string} name
 * @property {string} [description]
 * @property {object} inputSchema
 */

/**
 * @typedef {object} McpLegacySseClient
 * @property {() => Promise<readonly ToolDef[]>} listTools
 * @property {(name:string, args:Record<string,unknown>) => Promise<ToolCallResult>} callTool
 * @property {() => void} close
 */

/**
 * Create an MCP Legacy SSE client.
 *
 * @param {string} url - SSE endpoint URL.
 * @param {Record<string,string>} [extraHeaders]
 * @param {{useProxy?:boolean, proxyConfig?:ProxyConfig|null}} [options]
 * @returns {Promise<McpLegacySseClient>}
 */
export async function createLegacySseClient(url, extraHeaders = {}, { useProxy = false, proxyConfig = null } = {}) {
  let requestId = 0;
  let postUrl = '';
  let closed = false;

  // ── Fetch selection ────────────────────────────────────────────────────
  const _useProxy = shouldUseProxy(url, useProxy, proxyConfig);
  const requestFetch = _useProxy
    ? await ensureProxyFetch(proxyConfig)
    : globalThis.fetch.bind(globalThis);

  /** @type {Map<number, {resolve:(v:unknown)=>void, reject:(e:Error)=>void}>} */
  const pending = new Map();

  /** @type {ReadableStreamDefaultReader<Uint8Array>|null} */
  let sseReader = null;

  // ── Open SSE stream (GET) ──────────────────────────────────────────────
  /** @type {Response} */
  let sseResponse;
  try {
    sseResponse = await requestFetch(url, {
      headers: { Accept: 'text/event-stream', ...extraHeaders },
    });
  } catch (err) {
    throw wrapTransportError(/** @type {Error} */ (err), url);
  }

  if (!sseResponse.ok) {
    throw new Error(`MCP SSE connect failed: HTTP ${sseResponse.status}`);
  }

  const body = sseResponse.body;
  if (!body) throw new Error('MCP SSE: empty response body');

  sseReader = body.getReader();

  // ── Endpoint discovery ─────────────────────────────────────────────────
  /** @type {(()=>void)|null} */
  let endpointResolve = null;
  /** @type {((e:Error)=>void)|null} */
  let endpointReject = null;

  const endpointReady = new Promise((res, rej) => {
    endpointResolve = res;
    endpointReject = rej;
  });

  const endpointTimeout = setTimeout(
    () => endpointReject && endpointReject(new Error('MCP SSE: timed out waiting for endpoint event')),
    15_000,
  );

  // Background read loop — deferred to next microtask to ensure
  // `endpointReady` resolve/reject are wired before any data arrives.
  const readLoop = (async () => {
    await Promise.resolve();
    try {
      if (!sseReader) return;
      for await (const frame of parseSseFrames(sseReader)) {
        if (closed) break;
        if (frame.event === 'endpoint') {
          clearTimeout(endpointTimeout);
          try { postUrl = new URL(frame.data.trim(), url).href; } catch { postUrl = frame.data.trim(); }
          if (endpointResolve) endpointResolve();
          continue;
        }
        try {
          const msg = JSON.parse(frame.data);
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            if (msg.error) {
              p.reject(new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`));
            } else {
              p.resolve(msg.result);
            }
          }
        } catch { /* ignore unparseable events */ }
      }
    } catch (err) {
      const connErr = new Error(`MCP SSE connection lost: ${err.message}`);
      for (const p of pending.values()) p.reject(connErr);
      pending.clear();
      if (endpointReject) endpointReject(connErr);
    }
  })();

  try {
    await endpointReady;
  } catch (err) {
    throw wrapTransportError(/** @type {Error} */ (err), url);
  }

  // ── Request helpers ────────────────────────────────────────────────────

  /**
   * @param {string} method
   * @param {Record<string,unknown>} [params]
   * @returns {Promise<unknown>}
   */
  async function sendRequest(method, params = {}) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      requestFetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      }).catch((err) => {
        pending.delete(id);
        reject(wrapTransportError(/** @type {Error} */ (err), postUrl));
      });
    });
  }

  /**
   * @param {string} method
   * @param {Record<string,unknown>} [params]
   */
  function sendNotification(method, params = {}) {
    requestFetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    }).catch(() => {});
  }

  // ── Initialize handshake ───────────────────────────────────────────────
  await sendRequest('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    clientInfo: CLIENT_INFO,
  });
  sendNotification('notifications/initialized');

  return {
    async listTools() {
      return paginateList(sendRequest, 'tools/list', 'tools');
    },

    async callTool(name, args) {
      const result = await sendRequest('tools/call', { name, arguments: args });
      return /** @type {ToolCallResult} */ (result);
    },

    async listResources() {
      return paginateList(sendRequest, 'resources/list', 'resources');
    },

    async listResourceTemplates() {
      const result = await sendRequest('resources/templates/list');
      return /** @type {readonly import('./utils.js').ResourceTemplateDef[]} */ (
        Array.isArray(result?.resourceTemplates) ? result.resourceTemplates : []
      );
    },

    async readResource(uri) {
      const result = await sendRequest('resources/read', { uri });
      return /** @type {import('./utils.js').ResourceReadResult} */ (result);
    },

    async listPrompts() {
      return paginateList(sendRequest, 'prompts/list', 'prompts');
    },

    async getPrompt(name, args) {
      const result = await sendRequest('prompts/get', { name, arguments: args ?? {} });
      return /** @type {import('./utils.js').PromptGetResult} */ (result);
    },

    close() {
      closed = true;
      if (sseReader) {
        sseReader.cancel().catch(() => {});
        sseReader = null;
      }
      const err = new Error('MCP connection closed');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    },
  };
}
