/**
 * Runtime proxy configuration module.
 *
 * Passive config holder + test utility. NO global state mutation:
 *   - Does NOT replace globalThis.fetch
 *   - Does NOT call setGlobalDispatcher
 *   - Does NOT apply any side-effect on import
 *
 * Consumers (model chat pipeline, browser plugin, MCP, skill) obtain a
 * proxy-aware fetch via {@link createProxyFetch} when they need it.
 *
 * @typedef {ProxyConfig} ProxyConfig
 */

/** @import { ProxyConfig } from '../../agent-type/plugin.ts' */

import { ProxyAgent, Agent, fetch as undiciFetch } from 'undici';
import { createLogger } from './logger.js';

const log = createLogger('proxy');

// ── Sentinel value ────────────────────────────────────────────────────────────
// When the frontend/API sends this string as the password it means "don't
// overwrite the stored password" (it's the masked representation shown to
// callers of getProxyConfig).
export const PASSWORD_MASK = '••••••';

// ── Default / initial config ──────────────────────────────────────────────────

/** @type {ProxyConfig} */
let _cfg = {
  protocol:       'http',
  host:           'localhost',
  port:           7890,
  username:       '',
  password:       '',
  noProxy:        '',
  connectTimeout: 10_000,
};

// Override defaults from standard env vars on first import
const envUrl =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY  || process.env.http_proxy  ||
  process.env.ALL_PROXY   || process.env.all_proxy   || null;

if (envUrl) {
  try {
    const u = new URL(envUrl);
    _cfg = {
      ..._cfg,
      protocol: u.protocol.replace(':', ''),
      host:     u.hostname,
      port:     Number(u.port) || 80,
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
    log.info(`Config loaded from env: ${u.protocol}//${u.hostname}:${u.port}`);
  } catch {
    log.warn(`Could not parse proxy URL from env: ${envUrl}`);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Build a proxy URI string from a config object. */
function buildProxyUri(cfg) {
  const auth = cfg.username
    ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`
    : '';
  return `${cfg.protocol}://${auth}${cfg.host}:${cfg.port}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Valid proxy protocols. */
export const VALID_PROTOCOLS = ['http', 'https', 'socks5', 'socks4'];

/** Allowed field names for proxy config updates. */
export const ALLOWED_FIELDS = ['protocol', 'host', 'port', 'username', 'password', 'noProxy', 'connectTimeout'];

/**
 * Validate and sanitise a partial proxy config update.
 *
 * Throws with a human-readable message on the first invalid field.
 *
 * @param {Record<string, unknown>} partial
 * @returns {Record<string, unknown>} cleaned partial (types normalised)
 */
export function validateProxyUpdate(partial) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in partial) out[key] = partial[key];
  }

  if ('port' in out) {
    const port = Number(out.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('port must be an integer 1–65535');
    }
    out.port = port;
  }

  if ('protocol' in out && !VALID_PROTOCOLS.includes(out.protocol)) {
    throw new Error(`protocol must be one of: ${VALID_PROTOCOLS.join(', ')}`);
  }

  if ('host' in out) {
    if (typeof out.host !== 'string' || !out.host.trim()) {
      throw new Error('host must be a non-empty string');
    }
    out.host = out.host.trim();
  }

  if ('connectTimeout' in out) {
    const ms = Number(out.connectTimeout);
    if (!Number.isFinite(ms) || ms < 500) {
      throw new Error('connectTimeout must be ≥ 500 ms');
    }
    out.connectTimeout = ms;
  }

  return out;
}

/**
 * Validate a proxy test target URL (SSRF prevention).
 *
 * @param {string} target
 * @returns {string} validated URL
 * @throws {Error} if the target is invalid or uses a disallowed protocol
 */
export function validateTestTarget(target) {
  if (typeof target !== 'string') throw new Error('target must be a string URL');
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    throw new Error('target must be a valid URL');
  }
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new Error('target must use http or https');
  }
  return target;
}

/**
 * Create a fetch function that routes through the configured proxy.
 * Creates a new ProxyAgent on each call (the agent is pooled by undici).
 *
 * Consumers (model chat, MCP, skill, etc.) use this when they need to
 * proxy their outgoing HTTP requests.
 *
 * @param {Partial<ProxyConfig>} [overrides]  optional overrides (not persisted)
 * @returns {(input: RequestInfo, init?: RequestInit) => Promise<Response>}
 */
export function createProxyFetch(overrides) {
  const cfg = overrides ? { ..._cfg, ...overrides } : _cfg;
  const dispatcher = new ProxyAgent({
    uri:            buildProxyUri(cfg),
    connectTimeout: cfg.connectTimeout,
  });
  return (input, init) => undiciFetch(input, { ...init, dispatcher });
}

/**
 * Return a copy of the current config with the password masked.
 * @returns {ProxyConfig & { password: string }}
 */
export function getProxyConfig() {
  return { ..._cfg, password: _cfg.password ? PASSWORD_MASK : '' };
}

/**
 * Update zero or more fields and persist the change.
 *
 * Special password handling:
 *   • password === PASSWORD_MASK  → leave stored password unchanged (sentinel)
 *   • password === ''             → clear the stored password
 *   • any other string            → store as-is
 *
 * @param {Partial<ProxyConfig>} partial
 * @returns {ProxyConfig & { password: string }} updated (masked) config
 */
export function setProxyConfig(partial) {
  const update = { ...partial };
  if (update.password === PASSWORD_MASK) {
    delete update.password; // sentinel — preserve existing password
  }
  _cfg = { ..._cfg, ...update };
  return getProxyConfig();
}

/**
 * Test connectivity through the proxy.
 * Creates its own temporary dispatcher — does NOT touch the proxy config.
 *
 * Password sentinel is respected: if overrides.password === PASSWORD_MASK the
 * stored password is used for the test.
 *
 * @param {string}               [target='https://www.google.com']
 * @param {Partial<ProxyConfig>} [overrides]  transient overrides (not saved)
 * @returns {Promise<{ ok: boolean, status?: number, ms: number, error?: string }>}
 */
export async function testProxy(target = 'https://www.google.com', overrides) {
  const resolved = overrides ? { ...overrides } : {};
  if (resolved.password === PASSWORD_MASK) delete resolved.password;
  const cfg = { ..._cfg, ...resolved };

  const start = Date.now();
  const dispatcher = new ProxyAgent({
    uri:            buildProxyUri(cfg),
    connectTimeout: cfg.connectTimeout,
  });

  try {
    const res = await undiciFetch(target, {
      dispatcher,
      signal: AbortSignal.timeout(cfg.connectTimeout),
    });
    return { ok: true, status: res.status, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err.message };
  }
}
