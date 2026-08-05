/**
 * internal-plugins/devops/backend/services/ado-proxy.js — ADO reverse-proxy service
 *
 * Centralises URL validation, PAT decryption, auth-header creation, HTTP
 * forwarding, binary-body normalisation, and error translation.
 *
 * The decrypt function is obtained from host.getBackendConfig('rsaDecrypt')
 * at activation time, keeping the plugin decoupled from core backend internals.
 */

import { Agent, fetch as undiciFetch } from 'undici';

/** @import { Logger } from '../../../../agent-type/plugin.ts' */

// ── Direct (no-proxy) dispatcher — ADO traffic always goes straight out ───────
const directAgent = new Agent();

const DEFAULT_API_VERSION = '6.1-preview';

/** @type {Logger} */
const NOOP_LOGGER = { info() {}, ok() {}, warn() {}, error() {}, debug() {} };

function toErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an ADO proxy service bound to a PAT decrypt function.
 *
 * @param {{ decryptFn: (encrypted: string) => string, logger?: Logger }} options
 * @returns {AdoProxyService}
 */
export function createAdoProxyService(options) {
  const decryptPat = options.decryptFn;
  const log = options.logger ?? NOOP_LOGGER;

  function makeAuthHeader(pat) {
    return 'Basic ' + Buffer.from(':' + pat).toString('base64');
  }

  function withApiVersion(url, apiVersion) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}api-version=${apiVersion ?? DEFAULT_API_VERSION}`;
  }

  function parseJsonOrThrow(response) {
    return response.json().catch(() => {
      throw new Error('ADO returned non-JSON response');
    });
  }

  async function assertOkOrThrow({ response, method, url, logPrefix }) {
    if (response.ok) {
      return;
    }
    const text = await response.text().catch(() => '');
    log.warn(`${logPrefix} ${response.status} ${method} ${url} | ${text.slice(0, 200)}`);
    throw new Error(text || `ADO request failed with status ${response.status}`);
  }

  async function sendRequest({ url, pat, method, apiVersion, body, contentType, logPrefix }) {
    const plainPat = decryptPat(pat);
    if (!plainPat) {
      throw new Error('pat is invalid after decryption');
    }

    const fullUrl = withApiVersion(url, apiVersion);
    const headers = {
      Authorization: makeAuthHeader(plainPat),
      Accept: 'application/json',
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    let response;
    try {
      response = await undiciFetch(fullUrl, {
        method,
        headers,
        body,
        dispatcher: directAgent,
      });
    } catch (err) {
      const message = toErrorMessage(err);
      log.error(`${logPrefix} fetch error`, message);
      throw new Error(message);
    }

    await assertOkOrThrow({ response, method, url, logPrefix });
    if (response.status === 204) {
      return null;
    }
    return parseJsonOrThrow(response);
  }

  /**
   * Validate that the target URL is a valid https:// URL (SSRF prevention).
   */
  function validateUrl(url) {
    if (!url || typeof url !== 'string') return 'url is required';
    if (!url.startsWith('https://')) return 'url must start with https://';
    return null;
  }

  /**
   * Forward a JSON-envelope request to the ADO REST API.
   */
  async function callAdoProxy({ url, pat, method = 'GET', body, contentType, apiVersion }) {
    const urlErr = validateUrl(url);
    if (urlErr) throw new Error(urlErr);

    log.debug(`\u2192 ${method} ${url}`);

    let fetchBody = undefined;
    let resolvedContentType = contentType;
    if (body !== undefined && body !== null) {
      fetchBody = JSON.stringify(body);
      resolvedContentType = contentType ?? 'application/json';
    }

    return sendRequest({
      url,
      pat,
      method,
      apiVersion,
      body: fetchBody,
      contentType: resolvedContentType,
      logPrefix: 'ADO',
    });
  }

  /**
   * Normalise raw body input from various sources into a Buffer.
   */
  function normaliseBinaryBody(rawBody) {
    if (!rawBody) return rawBody;
    if (Buffer.isBuffer(rawBody)) return rawBody;
    if (rawBody instanceof Uint8Array) return Buffer.from(rawBody);
    if (
      typeof rawBody === 'object' &&
      rawBody.type === 'Buffer' &&
      Array.isArray(rawBody.data)
    ) {
      return Buffer.from(rawBody.data);
    }
    if (typeof rawBody === 'string') return Buffer.from(rawBody, 'base64');
    throw new Error('rawBody must be Buffer, Uint8Array, base64 string, or { type: "Buffer", data: number[] }');
  }

  /**
   * Forward raw binary data to the ADO REST API (file uploads, etc.).
   */
  async function uploadAdoProxy({ url, pat, contentType = 'application/octet-stream', apiVersion, rawBody }) {
    const urlErr = validateUrl(url);
    if (urlErr) throw new Error(urlErr);

    const bodyBuffer = normaliseBinaryBody(rawBody);
    log.debug(`\u2192 upload POST ${url} (${Buffer.isBuffer(bodyBuffer) ? bodyBuffer.byteLength : typeof bodyBuffer} bytes)`);

    const headersContentType = contentType;
    return sendRequest({
      url,
      pat,
      method: 'POST',
      apiVersion,
      body: bodyBuffer,
      contentType: headersContentType,
      logPrefix: 'ADO upload',
    });
  }

  return { callAdoProxy, uploadAdoProxy };
}

/** @typedef {ReturnType<typeof createAdoProxyService>} AdoProxyService */
