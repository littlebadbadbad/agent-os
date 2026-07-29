/**
 * Shared utilities for MCP transport implementations.
 */

/** MCP client identity advertised during the initialize handshake. */
export const CLIENT_INFO = { name: 'agent-sdk-backend', version: '0.1.0' };

/** Latest MCP protocol version supported by this client. */
export const MCP_PROTOCOL_VERSION = '2025-03-26';

/** Normalise an MCP tool-result payload to a plain string. */
export function serializeToolResult(result) {
  const text = (result.content ?? [])
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image') return `[image/${part.mimeType}]`;
      return JSON.stringify(part.resource);
    })
    .join('\n');
  return result.isError ? `[Tool error]\n${text}` : text;
}

// ── Error translation ──────────────────────────────────────────────────────

/** Map raw Node.js error codes to human-readable messages. */
const ERROR_MESSAGES = {
  ECONNREFUSED:  () => 'Connection refused — is the server running?',
  ENOTFOUND:     () => 'DNS lookup failed — check the URL or your network.',
  ETIMEDOUT:     () => 'Connection timed out.',
  ECONNRESET:    () => 'Connection reset by server.',
  ECONNABORTED:  () => 'Connection aborted.',
  EADDRNOTAVAIL: () => 'Address not available — is a proxy needed?',
  EPIPE:         () => 'Connection broken (EPIPE).',
  CERT_HAS_EXPIRED:   () => 'TLS certificate has expired.',
  DEPTH_ZERO_SELF_SIGNED_CERT: () => 'Self-signed TLS certificate.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: () => 'TLS certificate verification failed.',
  EHOSTUNREACH:  () => 'Host unreachable.',
  ENETUNREACH:   () => 'Network unreachable.',
};

/**
 * Translate a raw fetch/network error into a clear, actionable message.
 *
 * @param {Error} err - The raw error from fetch().
 * @param {string} url - The target URL for context.
 * @returns {Error}
 */
export function wrapTransportError(err, url) {
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch { /* keep raw url */ }

  const code = /** @type {keyof typeof ERROR_MESSAGES} */ (err.cause?.code || err.code);
  const detail = ERROR_MESSAGES[code]?.() ?? err.message;

  const wrapped = new Error(`MCP ${hostname}: ${detail}`);
  wrapped.cause = err;
  return wrapped;
}

// ── Proxy bypass logic ──────────────────────────────────────────────────────

/**
 * Loopback / private address patterns that must never be routed through a proxy.
 *
 * - IPv4 loopback: 127.0.0.0/8
 * - IPv6 loopback: ::1
 * - Link-local: 169.254.0.0/16
 * - Private RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 */
const LOOPBACK_OR_PRIVATE_RE = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]|::1|169\.254\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/i;

/**
 * Decide whether a given URL should be routed through the configured proxy.
 *
 * @param {string} url - Target URL (e.g. "http://localhost:3000/mcp").
 * @param {boolean} userFlag - The server-level `useProxy` flag from the MCP config.
 * @param {{ host?: string, port?: number, noProxy?: string } | null} [proxyCfg] - Proxy config from backend.
 * @returns {boolean}
 */
export function shouldUseProxy(url, userFlag, proxyCfg) {
  // 1. User explicitly opted out.
  if (!userFlag) return false;

  // 2. No proxy configured at all (port 0 means the local proxy server isn't running).
  if (!proxyCfg || !proxyCfg.host || !proxyCfg.port) return false;

  // 3. Parse the target URL to extract the hostname.
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false; // malformed URL — no proxy
  }

  // 4. Never proxy loopback or private addresses.
  if (LOOPBACK_OR_PRIVATE_RE.test(hostname)) return false;

  // 5. Respect explicit noProxy patterns (comma/semicolon/space separated).
  const noProxy = proxyCfg.noProxy?.trim();
  if (noProxy) {
    const patterns = noProxy.split(/[,;\s]+/).filter(Boolean);
    if (patterns.some((p) => {
      try {
        return new RegExp(
          '^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
          'i',
        ).test(hostname);
      } catch {
        return hostname === p || hostname.endsWith('.' + p);
      }
    })) {
      return false;
    }
  }

  return true;
}

// ── Proxy fetch factory (shared by HTTP & SSE transports) ───────────────────

/** @type {((input: RequestInfo, init?: RequestInit) => Promise<Response>) | null} */
let _proxyFetchCache = null;

/**
 * Lazily creates an undici ProxyAgent + fetch that routes through the
 * configured proxy.  The Agent is created once and reused (connection pooling).
 *
 * @param {{ protocol?: string, host?: string, port?: number, connectTimeout?: number }} proxyCfg
 * @returns {Promise<(input: RequestInfo, init?: RequestInit) => Promise<Response>>}
 */
export async function ensureProxyFetch(proxyCfg) {
  if (!_proxyFetchCache) {
    const { fetch: undiciFetch, ProxyAgent } = await import('undici');
    const proxyUri = `${proxyCfg.protocol ?? 'http'}://${proxyCfg.host}:${proxyCfg.port}`;
    const agent = new ProxyAgent({
      uri: proxyUri,
      connectTimeout: proxyCfg.connectTimeout ?? 10_000,
    });
    _proxyFetchCache = (input, init) => undiciFetch(input, { ...init, dispatcher: agent });
  }
  return _proxyFetchCache;
}
