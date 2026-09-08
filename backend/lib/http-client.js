/**
 * backend/lib/http-client.js — Shared HTTP fetch wrapper for AI API calls.
 *
 * Provides:
 * - Standardized request construction with auth headers
 * - Error response parsing with body truncation
 * - AbortSignal passthrough
 * - Content-Type header management
 * - Browser-DevTools-style network logging of every request/response
 *   (full headers + body; streaming bodies are logged chunk-by-chunk).
 *   Disable with env HTTP_LOG=off.
 */

import { createLogger } from './logger.js';

const log = createLogger('http-client');

// ── Network logging (browser DevTools Network style) ─────────────────────────

/** Set HTTP_LOG=off to suppress full request/response logging. */
const NETLOG = process.env.HTTP_LOG !== 'off';

/** Header names whose values are masked in logs (still identifiable by prefix). */
const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'proxy-authorization', 'cookie']);

let _netSeq = 0;

function maskSecret(value) {
  const s = String(value);
  if (s.length <= 10) return '***';
  return `${s.slice(0, 6)}…${s.slice(-4)} [masked, ${s.length} chars]`;
}

/** Copy a Headers object (or plain object) into a plain object, masking secrets. */
function sanitizeHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function') {
    // fetch Headers object: forEach(value, key)
    headers.forEach((value, key) => {
      out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? maskSecret(value) : value;
    });
  } else {
    for (const [key, value] of Object.entries(headers)) {
      out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? maskSecret(value) : value;
    }
  }
  return out;
}

/** Pretty-print a JSON string; fall back to the raw text if unparsable. */
function prettyJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function netLogRequest(id, url, headers, bodyStr) {
  log.info(
    `→ #${id} POST ${url}\n` +
    `  Request Headers: ${JSON.stringify(sanitizeHeaders(headers), null, 2)}\n` +
    `  Request Body: ${prettyJson(bodyStr)}`,
  );
}

function netLogResponseHead(id, resp, startMs) {
  log.info(
    `← #${id} ${resp.status} ${resp.statusText || ''}· TTFB ${Date.now() - startMs} ms\n` +
    `  Response Headers: ${JSON.stringify(sanitizeHeaders(resp.headers), null, 2)}`,
  );
}

/**
 * Drain one branch of a tee'd response body, logging every chunk as it
 * arrives (works for both one-shot JSON bodies and streaming SSE bodies).
 * The other branch is returned to the caller untouched.
 */
async function netLogResponseBody(id, stream, startMs) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let chunks = 0;
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1;
      bytes += value?.byteLength ?? 0;
      log.info(`← #${id} [body #${chunks}] ${decoder.decode(value, { stream: true })}`);
    }
    log.ok(`← #${id} done · ${chunks} chunks / ${bytes} bytes / ${Date.now() - startMs} ms`);
  } catch (err) {
    log.warn(`← #${id} response body logging aborted: ${err.message}`);
  }
}

/**
 * Build the standard request headers for an API call.
 *
 * @param {string|null|undefined} apiKey
 * @param {string} [contentType='application/json']
 * @param {Record<string,string>} [extraHeaders]
 * @returns {Record<string,string>}
 */
export function buildHeaders(apiKey, contentType = 'application/json', extraHeaders = {}) {
  const headers = { 'Content-Type': contentType, ...extraHeaders };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  // Anthropic uses a different auth header format
  if (extraHeaders['x-api-key']) {
    delete headers['Authorization'];
  }
  return headers;
}

/**
 * Build Anthropic-specific headers.
 *
 * @param {string} apiKey
 * @param {string} [anthropicVersion='2023-06-01']
 * @returns {Record<string,string>}
 */
export function buildAnthropicHeaders(apiKey, anthropicVersion = '2023-06-01') {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': anthropicVersion,
  };
}

/**
 * Make an HTTP POST request to an AI API endpoint.
 *
 * @param {string}   url       — Full endpoint URL
 * @param {object}   headers   — Request headers
 * @param {object}   body      — JSON-serializable request body
 * @param {AbortSignal} [signal]
 * @param {(input: RequestInfo, init?: RequestInit) => Promise<Response>} [customFetch] — optional custom fetch function (e.g. proxy-aware fetch)
 * @returns {Promise<Response>}
 */
export async function post(url, headers, body, signal, customFetch) {
  const f = customFetch ?? fetch;
  const bodyStr = JSON.stringify(body);
  const id = ++_netSeq;

  if (NETLOG) netLogRequest(id, url, headers, bodyStr);

  const startMs = Date.now();
  const resp = await f(url, {
    method: 'POST',
    headers,
    body: bodyStr,
    signal,
  });

  if (!NETLOG) return resp;

  // Log status + response headers, then tee the body so the consumer still
  // gets the full stream while we log every chunk as it arrives.
  netLogResponseHead(id, resp, startMs);
  if (!resp.body) {
    log.ok(`← #${id} ${resp.status} · (no response body) · ${Date.now() - startMs} ms`);
    return resp;
  }
  const [logged, passed] = resp.body.tee();
  netLogResponseBody(id, logged, startMs).catch(() => { /* logging must never break the call */ });
  // Rebuild a Response with the untouched branch so resp.json()/resp.text()/
  // resp.body all behave exactly as before.
  return new Response(passed, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  });
}

/**
 * Parse an error response and throw a descriptive Error.
 *
 * @param {Response} resp      — The failed response object
 * @param {string}   label     — Human-readable label for error messages (e.g. provider name)
 * @returns {never}
 */
export async function throwHttpError(resp, label) {
  let errBody = '';
  try { errBody = await resp.text(); } catch { /* ignore */ }
  throw new Error(`${label} API ${resp.status}: ${errBody.slice(0, 500)}`);
}

/**
 * Parse usage from an OpenAI-compatible response.
 *
 * @param {object|null|undefined} u  — The `usage` field from the API response
 * @returns {{ promptTokens:number, completionTokens:number, totalTokens:number }|undefined}
 */
export function parseUsage(u) {
  if (!u) return undefined;
  return {
    promptTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    completionTokens: u.completion_tokens ?? u.output_tokens ?? 0,
    totalTokens: u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
  };
}

/**
 * Parse usage from an Anthropic response.
 *
 * @param {object|null|undefined} u  — The `usage` field from the Anthropic API
 * @returns {{ promptTokens:number, completionTokens:number, totalTokens:number }|undefined}
 */
export function parseAnthropicUsage(u) {
  if (!u) return undefined;
  return {
    promptTokens: u.input_tokens ?? 0,
    completionTokens: u.output_tokens ?? 0,
    totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
  };
}
