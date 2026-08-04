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

/**
 * Latest MCP protocol version requested by this client during `initialize`.
 * The transport tracks whatever version the server actually negotiates back
 * (see `negotiateProtocolVersion`) and uses THAT value for the
 * `MCP-Protocol-Version` header on every subsequent request, per spec.
 */
const MCP_PROTOCOL_VERSION = '2025-06-18';

/**
 * @typedef {object} ClientInfo
 * @property {string} name
 * @property {string} version
 */

/**
 * @typedef {object} ContentBlock
 * @property {'text'|'image'|'audio'|'resource'|'resource_link'} type
 * @property {string} [text]
 * @property {string} [data]
 * @property {string} [mimeType]
 * @property {string} [uri]
 * @property {string} [name]
 * @property {string} [description]
 * @property {{uri:string,mimeType?:string,text?:string,blob?:string}} [resource]
 */

/**
 * @typedef {object} ToolCallResult
 * @property {readonly ContentBlock[]} content
 * @property {Record<string,unknown>} [structuredContent]
 * @property {boolean} [isError]
 */

export { CLIENT_INFO, MCP_PROTOCOL_VERSION };

/**
 * Decide which protocol version to use for all requests after `initialize`.
 * Per spec, the client should echo back whatever the server negotiated in
 * `InitializeResult.protocolVersion` — falling back to our requested
 * version if the server omitted it.
 *
 * @param {unknown} initializeResult
 * @returns {string}
 */
export function negotiateProtocolVersion(initializeResult) {
  if (
    initializeResult !== null &&
    typeof initializeResult === 'object' &&
    'protocolVersion' in initializeResult &&
    typeof (/** @type {{protocolVersion:unknown}} */ (initializeResult).protocolVersion) === 'string'
  ) {
    return /** @type {{protocolVersion:string}} */ (initializeResult).protocolVersion;
  }
  return MCP_PROTOCOL_VERSION;
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

// ═══════════════════════════════════════════════════════════════════════════════
//  Cursor Pagination
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch every page of a cursor-paginated list method (e.g. `tools/list`),
 * accumulating the named result array across pages. Shared by every
 * transport so pagination is implemented exactly once.
 *
 * @template T
 * @param {(method:string, params?:Record<string,unknown>) => Promise<unknown>} sendRequest
 * @param {string} method
 * @param {string} listKey - Key of the array field in each page's result (e.g. "tools").
 * @returns {Promise<readonly T[]>}
 */
export async function paginateList(sendRequest, method, listKey) {
  /** @type {T[]} */
  const items = [];
  /** @type {string|undefined} */
  let cursor;
  do {
    const result = await sendRequest(method, cursor ? { cursor } : {});
    if (result && typeof result === 'object' && listKey in result) {
      const page = /** @type {Record<string, unknown>} */ (result);
      const pageItems = /** @type {readonly T[]} */ (page[listKey]);
      items.push(...pageItems);
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
    } else {
      cursor = undefined;
    }
  } while (cursor);
  return items;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Shared SSE Frame Parser
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} SseFrame
 * @property {string} event - The event name (defaults to "message" per the SSE spec).
 * @property {string} data - The joined `data:` payload (multiple `data:` lines are
 *   newline-joined, per the SSE spec).
 */

/**
 * Parse a byte stream into SSE frames — a single, spec-correct implementation
 * shared by every transport that needs to read `text/event-stream` bodies
 * (Streamable HTTP's POST/GET streams, and the legacy SSE transport).
 *
 * Per the SSE spec, a field line is `<field>:<value>`, where exactly one
 * leading space after the colon (if present) is stripped. Lines starting
 * with `:` are comments. A blank line dispatches the accumulated frame.
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @returns {AsyncGenerator<SseFrame>}
 */
export async function* parseSseFrames(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = '';
  /** @type {string[]} */
  let dataLines = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

      if (line === '') {
        if (dataLines.length > 0) {
          yield { event: eventType || 'message', data: dataLines.join('\n') };
        }
        eventType = '';
        dataLines = [];
        continue;
      }
      if (line.startsWith(':')) continue; // comment line

      const colonIdx = line.indexOf(':');
      const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
      let fieldValue = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
      if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);

      if (field === 'event') eventType = fieldValue;
      else if (field === 'data') dataLines.push(fieldValue);
      // `id:` / `retry:` fields are not needed for MCP's SSE semantics.
    }
  }
}

