/**
 * MCP SSE transport (MCP spec 2025-03-26).
 *
 * Opens a long-lived GET SSE stream to receive server-sent results, then
 * POSTs JSON-RPC requests to the endpoint URL advertised by the server's
 * first `endpoint` event.  A background read loop correlates responses by
 * JSON-RPC id.
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
 * @param {string} url - MCP server SSE URL.
 * @param {Record<string,string>} [extraHeaders] - Additional headers (e.g. auth).
 * @param {{ useProxy?: boolean, proxyConfig?: object }} [options]
 */
export async function createSseClient(url, extraHeaders = {}, { useProxy = false, proxyConfig } = {}) {
  let requestId = 0;

  // ── Fetch selection ────────────────────────────────────────────────────
  const _useProxy = shouldUseProxy(url, useProxy, proxyConfig);
  const requestFetch = _useProxy
    ? await ensureProxyFetch(proxyConfig)
    : globalThis.fetch.bind(globalThis);

  /** @type {Map<number, {resolve: (v:any)=>void, reject:(e:Error)=>void}>} */
  const pending = new Map();
  let postUrl = '';
  let closed = false;
  let sseReader = null;

  // ── Open SSE stream (GET) ──────────────────────────────────────────────
  let sseResponse;
  try {
    sseResponse = await requestFetch(url, {
      headers: { Accept: 'text/event-stream', ...extraHeaders },
    });
  } catch (err) {
    throw wrapTransportError(err, url);
  }
  if (!sseResponse.ok) {
    throw new Error(`MCP SSE connect failed: HTTP ${sseResponse.status}`);
  }

  sseReader = sseResponse.body.getReader();
  const decoder = new TextDecoder();

  // ── Endpoint discovery ─────────────────────────────────────────────────
  let endpointResolve, endpointReject;
  const endpointReady = new Promise((res, rej) => {
    endpointResolve = res;
    endpointReject = rej;
  });
  const endpointTimeout = setTimeout(
    () => endpointReject(new Error('MCP SSE: timed out waiting for endpoint event')),
    15_000,
  );

  // Background read loop — runs for the lifetime of the connection.
  (async () => {
    let buffer = '';
    let eventType = '';
    let dataLines = '';
    try {
      while (!closed) {
        const { done, value } = await sseReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines += (dataLines ? '\n' : '') + line.slice(5);
          } else if (line === '') {
            if (dataLines) {
              if (eventType === 'endpoint') {
                clearTimeout(endpointTimeout);
                try { postUrl = new URL(dataLines.trim(), url).href; } catch { postUrl = dataLines.trim(); }
                endpointResolve();
              } else {
                try {
                  const msg = JSON.parse(dataLines);
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
            }
            eventType = '';
            dataLines = '';
          }
        }
      }
    } catch (err) {
      const connErr = new Error(`MCP SSE connection lost: ${err.message}`);
      for (const p of pending.values()) p.reject(connErr);
      pending.clear();
      endpointReject(connErr);
    }
  })();

  try {
    await endpointReady;
  } catch (err) {
    throw wrapTransportError(err, url);
  }

  // ── Request helpers ────────────────────────────────────────────────────
  async function sendRequest(method, params) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      requestFetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      }).catch((err) => {
        pending.delete(id);
        reject(wrapTransportError(err, postUrl));
      });
    });
  }

  function sendNotification(method, params) {
    requestFetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
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
      closed = true;
      sseReader?.cancel().catch(() => {});
      const err = new Error('MCP connection closed');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    },
  };
}
