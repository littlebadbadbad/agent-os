/**
 * Runtime proxy configuration module.
 *
 * • Initialises from env vars (HTTPS_PROXY / HTTP_PROXY / ALL_PROXY) on import.
 * • Default when no env var: proxy ON, http://localhost:7890.
 * • Exports getProxyConfig / setProxyConfig for runtime API changes.
 * • Exports testProxy for one-off connectivity probes (does NOT touch the
 *   global dispatcher — safe to call concurrently).
 *
 * Why we replace globalThis.fetch:
 *   Node.js 22's built-in fetch uses an internal undici instance that is
 *   completely separate from the npm "undici" package, so setGlobalDispatcher
 *   has no effect on it.  Replacing globalThis.fetch with undici's own fetch
 *   (which does respect setGlobalDispatcher) makes all bare fetch() calls in
 *   every module go through the proxy.
 *
 * @typedef {import('../../agent-type/plugin.ts').ProxyConfig} ProxyConfig
 */

import { setGlobalDispatcher, ProxyAgent, Agent, fetch as undiciFetch } from 'undici';
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
  enabled:        true,
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

/**
 * (Re-)apply the global undici dispatcher and replace globalThis.fetch so that
 * all bare fetch() calls anywhere in this process route through the proxy.
 */
function applyDispatcher(cfg) {
  if (cfg.enabled) {
    setGlobalDispatcher(new ProxyAgent({
      uri:            buildProxyUri(cfg),
      connectTimeout: cfg.connectTimeout,
    }));
    log.info(`Proxy ON  → ${cfg.protocol}://${cfg.host}:${cfg.port}`);
  } else {
    setGlobalDispatcher(new Agent({ connect: { timeout: cfg.connectTimeout } }));
    log.info('Proxy OFF → direct connection');
  }
  // Always replace globalThis.fetch with undici's fetch so the global
  // dispatcher (set above) is respected by all bare fetch() calls.
  globalThis.fetch = undiciFetch;
}

// Apply on module load
applyDispatcher(_cfg);

// ── Public API ────────────────────────────────────────────────────────────────

/** Valid proxy protocols. */
export const VALID_PROTOCOLS = ['http', 'https', 'socks5', 'socks4'];

/** Allowed field names for proxy config updates. */
export const ALLOWED_FIELDS = ['enabled', 'protocol', 'host', 'port', 'username', 'password', 'noProxy', 'connectTimeout'];

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

  if ('enabled' in out) {
    out.enabled = Boolean(out.enabled);
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
 * Return a copy of the current config with the password masked.
 * @returns {ProxyConfig & { password: string }}
 */
export function getProxyConfig() {
  return { ..._cfg, password: _cfg.password ? PASSWORD_MASK : '' };
}

/**
 * Update zero or more fields and immediately re-apply the global dispatcher.
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
  applyDispatcher(_cfg);
  return getProxyConfig();
}

/**
 * Test connectivity using the current config (or inline overrides).
 * Creates its own temporary dispatcher — does NOT modify the global one.
 *
 * Password sentinel is respected: if overrides.password === PASSWORD_MASK the
 * stored password is used for the test.
 *
 * @param {string}               [target='https://www.google.com']
 * @param {Partial<ProxyConfig>} [overrides]  transient overrides (not saved)
 * @returns {Promise<{ ok: boolean, status?: number, ms: number, error?: string }>}
 */
export async function testProxy(target = 'https://www.google.com', overrides) {
  // Resolve overrides: strip sentinel so _cfg.password is used instead
  const resolved = overrides ? { ...overrides } : {};
  if (resolved.password === PASSWORD_MASK) delete resolved.password;
  const cfg = { ..._cfg, ...resolved };

  const start = Date.now();
  let dispatcher;
  if (cfg.enabled) {
    dispatcher = new ProxyAgent({
      uri:            buildProxyUri(cfg),
      connectTimeout: cfg.connectTimeout,
    });
  } else {
    dispatcher = new Agent({ connect: { timeout: cfg.connectTimeout } });
  }

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
