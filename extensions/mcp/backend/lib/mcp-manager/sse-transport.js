/**
 * MCP SSE transport (MCP spec 2024-11-05).
 *
 * Opens a long-lived GET SSE stream to receive server-sent results, then
 * POSTs JSON-RPC requests to the endpoint URL advertised by the server's
 * first `endpoint` event.  A background read loop correlates responses by
 * JSON-RPC id.
 *
 * Proxy support:
 *   When `useProxy` is true and a `proxyConfig` is provided, all connections
 *   route through the configured proxy.  When false, the default Node.js
 *   fetch is used (direct connection).
 */

import { CLIENT_INFO, serializeToolResult } from './transport-utils.js';

// ── Proxy fetch (lazily initialised) ──────────────────────────────────────────

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
export async function createSseClient(url, extraHeaders = {}, { useProxy = true, proxyConfig } = {}) {
  let requestId = 0;

  // Select fetch function once: proxy-aware fetch, or default Node.js fetch.
  const requestFetch = useProxy && proxyConfig
    ? await ensureProxyFetch(proxyConfig)
    : globalThis.fetch.bind(globalThis);

  // `url` is also used as the base for endpoint URL resolution below.
  /** @type {Map<number, {resolve: (v:any)=>void, reject:(e:Error)=>void}>} */
  const pending = new Map();
  let postUrl = '';
  let closed = false;
  let sseReader = null;

  // Open the SSE stream (GET).
  const sseResponse = await requestFetch(url, {
    headers: { Accept: 'text/event-stream', ...extraHeaders },
  });
  if (!sseResponse.ok) {
    throw new Error(`MCP SSE connect failed: HTTP ${sseResponse.status}`);
  }

  sseReader = sseResponse.body.getReader();
  const decoder = new TextDecoder();

  // Endpoint promise — resolves once the server advertises its POST URL.
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
                try {
                  postUrl = new URL(dataLines.trim(), url).href;
                } catch {
                  postUrl = dataLines.trim();
                }
                endpointResolve();
              } else {
                // JSON-RPC response
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
      // Connection lost — reject all pending requests.
      const connErr = new Error(`MCP SSE connection lost: ${err.message}`);
      for (const p of pending.values()) p.reject(connErr);
      pending.clear();
      endpointReject(connErr);
    }
  })();

  await endpointReady;

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
        reject(err instanceof Error ? err : new Error(String(err)));
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

  // Handshake
  await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
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
