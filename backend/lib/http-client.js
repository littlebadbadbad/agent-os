/**
 * backend/lib/http-client.js — Shared HTTP fetch wrapper for AI API calls.
 *
 * Provides:
 * - Standardized request construction with auth headers
 * - Error response parsing with body truncation
 * - AbortSignal passthrough
 * - Content-Type header management
 */

import { createLogger } from './logger.js';

const log = createLogger('http-client');

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
 * @returns {Promise<Response>}
 */
export async function post(url, headers, body, signal) {
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  return resp;
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
