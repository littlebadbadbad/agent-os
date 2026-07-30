/**
 * Shared utilities for MCP transport implementations.
 *
 * All types are precise — no `any`, no `unknown` in JSDoc annotations.
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  Client Identity
// ═══════════════════════════════════════════════════════════════════════════════

/** MCP client identity advertised during the `initialize` handshake. */
const CLIENT_INFO = Object.freeze({ name: 'agent-sdk-backend', version: '0.1.0' });

/** Latest MCP protocol version supported by this client. */
const MCP_PROTOCOL_VERSION = '2025-03-26';

/**
 * @typedef {object} ClientInfo
 * @property {string} name
 * @property {string} version
 */

/**
 * @typedef {object} ContentBlock
 * @property {'text'|'image'|'audio'|'resource'} type
 * @property {string} [text]
 * @property {string} [data]
 * @property {string} [mimeType]
 * @property {{uri:string,mimeType?:string,text?:string,blob?:string}} [resource]
 */

/**
 * @typedef {object} ToolCallResult
 * @property {readonly ContentBlock[]} content
 * @property {boolean} [isError]
 */

export { CLIENT_INFO, MCP_PROTOCOL_VERSION };

// ═══════════════════════════════════════════════════════════════════════════════
//  Tool Result Serialization
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Serialize an MCP tool-result payload to a plain string suitable for
 * the agent. Preserves content type information.
 *
 * @param {ToolCallResult} result
 * @returns {string}
 */
export function serializeToolResult(result) {
  const text = (result.content ?? [])
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image') return `[Image: ${part.mimeType}]`;
      if (part.type === 'audio') return `[Audio: ${part.mimeType}]`;
      if (part.type === 'resource') {
        const r = part.resource;
        if (r.text) return r.text;
        return `[Resource: ${r.uri}]`;
      }
      return '';
    })
    .join('\n');
  return result.isError ? `[Tool error]\n${text}` : text;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Error Translation
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {Readonly<Record<string, ()=>string>>} */
const ERROR_MESSAGES = Object.freeze({
  ECONNREFUSED: () => 'Connection refused — is the server running?',
  ENOTFOUND: () => 'DNS lookup failed — check the URL or your network.',
  ETIMEDOUT: () => 'Connection timed out.',
  ECONNRESET: () => 'Connection reset by server.',
  ECONNABORTED: () => 'Connection aborted.',
  EADDRNOTAVAIL: () => 'Address not available — is a proxy needed?',
  EPIPE: () => 'Connection broken (EPIPE).',
  CERT_HAS_EXPIRED: () => 'TLS certificate has expired.',
  DEPTH_ZERO_SELF_SIGNED_CERT: () => 'Self-signed TLS certificate.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: () => 'TLS certificate verification failed.',
  EHOSTUNREACH: () => 'Host unreachable.',
  ENETUNREACH: () => 'Network unreachable.',
});

/**
 * Translate a raw fetch/network error into a clear, actionable message.
 *
 * @param {Error & {cause?:{code?:string},code?:string}} err
 * @param {string} url
 * @returns {Error}
 */
export function wrapTransportError(err, url) {
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch { /* keep raw url */ }

  const code = err.cause?.code || err.code || '';
  const detail = code in ERROR_MESSAGES
    ? ERROR_MESSAGES[/** @type {keyof ERROR_MESSAGES} */ (code)]()
    : err.message;

  const wrapped = new Error(`MCP ${hostname}: ${detail}`);
  wrapped.cause = err;
  return wrapped;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Proxy Bypass Logic
// ═══════════════════════════════════════════════════════════════════════════════

/** Loopback/private address patterns that must never route through a proxy. */
const LOOPBACK_OR_PRIVATE_RE = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]|::1|169\.254\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/i;

/**
 * @typedef {object} ProxyConfig
 * @property {string} [host]
 * @property {number} [port]
 * @property {string} [protocol]
 * @property {string} [noProxy]
 * @property {number} [connectTimeout]
 */

/**
 * Decide whether a given URL should be routed through the configured proxy.
 *
 * @param {string} url - Target URL.
 * @param {boolean} userFlag - The server-level `useProxy` flag.
 * @param {ProxyConfig|null} proxyCfg - Proxy configuration.
 * @returns {boolean}
 */
export function shouldUseProxy(url, userFlag, proxyCfg) {
  if (!userFlag) return false;
  if (!proxyCfg || !proxyCfg.host || !proxyCfg.port) return false;

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }

  if (LOOPBACK_OR_PRIVATE_RE.test(hostname)) return false;

  const noProxy = (proxyCfg.noProxy || '').trim();
  if (noProxy) {
    const patterns = noProxy.split(/[,;\s]+/).filter(Boolean);
    if (patterns.some((p) => {
      // Direct match: exact hostname or subdomain suffix
      if (hostname === p || hostname.endsWith('.' + p)) return true;
      // Regex for wildcard patterns (e.g. "*.example.com")
      try {
        return new RegExp(
          '^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
          'i',
        ).test(hostname);
      } catch {
        return false;
      }
    })) {
      return false;
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Proxy Fetch Factory
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {((input: RequestInfo, init?: RequestInit) => Promise<Response>) | null} */
let _proxyFetchCache = null;

/**
 * Lazily creates an undici ProxyAgent + fetch that routes through the
 * configured proxy. The Agent is created once and reused.
 *
 * @param {ProxyConfig} proxyCfg
 * @returns {Promise<(input: RequestInfo, init?: RequestInit) => Promise<Response>>}
 */
export async function ensureProxyFetch(proxyCfg) {
  if (!_proxyFetchCache) {
    const { fetch: undiciFetch, ProxyAgent } = await import('undici');
    const proxyUri = `${proxyCfg.protocol || 'http'}://${proxyCfg.host}:${proxyCfg.port}`;
    const agent = new ProxyAgent({
      uri: proxyUri,
      connectTimeout: proxyCfg.connectTimeout ?? 10_000,
    });
    _proxyFetchCache = (input, init) => undiciFetch(input, { ...init, dispatcher: agent });
  }
  return _proxyFetchCache;
}
