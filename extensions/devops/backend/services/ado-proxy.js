/**
 * extensions/devops/backend/services/ado-proxy.js — ADO reverse-proxy service
 *
 * Centralises URL validation, PAT decryption, auth-header creation, HTTP
 * forwarding, binary-body normalisation, and error translation.
 *
 * The decrypt function is obtained from host.getBackendConfig('rsaDecrypt')
 * at activation time, keeping the plugin decoupled from core backend internals.
 */

import { Agent, fetch as undiciFetch } from 'undici';
import { createLogger } from '../../../../backend/lib/logger.js';

// ── Direct (no-proxy) dispatcher — ADO traffic always goes straight out ───────
const directAgent = new Agent();

const DEFAULT_API_VERSION = '6.1-preview';

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an ADO proxy service bound to a PAT decrypt function.
 *
 * @param {(encrypted: string) => string} decryptFn  PAT decryption function
 * @returns {AdoProxyService}
 */
export function createAdoProxyService(decryptFn) {
  const log = createLogger('devops-ado-proxy');
  const decryptPat = decryptFn;

  function makeAuthHeader(pat) {
    return 'Basic ' + Buffer.from(':' + pat).toString('base64');
  }

  function withApiVersion(url, apiVersion) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}api-version=${apiVersion ?? DEFAULT_API_VERSION}`;
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

    const plainPat = decryptPat(pat);
    const fullUrl = withApiVersion(url, apiVersion);
    log.debug(`\u2192 ${method} ${url}`);

    const headers = {
      Authorization: makeAuthHeader(plainPat),
      Accept: 'application/json',
    };

    let fetchBody;
    if (body !== undefined && body !== null) {
      fetchBody = JSON.stringify(body);
      headers['Content-Type'] = contentType ?? 'application/json';
    }

    let adoRes;
    try {
      adoRes = await undiciFetch(fullUrl, { method, headers, body: fetchBody, dispatcher: directAgent });
    } catch (err) {
      log.error('ADO fetch error', err.message);
      throw new Error(err.message);
    }

    if (!adoRes.ok) {
      const text = await adoRes.text().catch(() => '');
      log.warn(`ADO ${adoRes.status} ${method} ${url} | ${text.slice(0, 200)}`);
      throw new Error(text);
    }
    if (adoRes.status === 204) return null;

    let data;
    try {
      data = await adoRes.json();
    } catch {
      throw new Error('ADO returned non-JSON response');
    }
    return data;
  }

  /**
   * Normalise raw body input from various sources into a Buffer.
   */
  function normaliseBinaryBody(rawBody) {
    if (!rawBody) return rawBody;
    if (Buffer.isBuffer(rawBody)) return rawBody;
    if (rawBody instanceof Uint8Array) return Buffer.from(rawBody);
    if (typeof rawBody === 'object' && rawBody.type === 'Buffer') return Buffer.from(rawBody.data);
    if (typeof rawBody === 'string') return Buffer.from(rawBody, 'base64');
    return rawBody;
  }

  /**
   * Forward raw binary data to the ADO REST API (file uploads, etc.).
   */
  async function uploadAdoProxy({ url, pat, contentType = 'application/octet-stream', apiVersion, rawBody }) {
    const urlErr = validateUrl(url);
    if (urlErr) throw new Error(urlErr);

    const plainPat = decryptPat(pat);
    const bodyBuffer = normaliseBinaryBody(rawBody);

    const fullUrl = withApiVersion(url, apiVersion);
    log.debug(`\u2192 upload POST ${url} (${Buffer.isBuffer(bodyBuffer) ? bodyBuffer.byteLength : typeof bodyBuffer} bytes)`);

    const headers = {
      Authorization: makeAuthHeader(plainPat),
      Accept: 'application/json',
      'Content-Type': contentType,
    };
    if (Buffer.isBuffer(bodyBuffer)) {
      headers['Content-Length'] = String(bodyBuffer.byteLength);
    }

    let adoRes;
    try {
      adoRes = await undiciFetch(fullUrl, {
        method: 'POST',
        headers,
        body: bodyBuffer,
        dispatcher: directAgent,
      });
    } catch (err) {
      log.error('ADO upload fetch error', err.message);
      throw new Error(err.message);
    }

    if (!adoRes.ok) {
      const text = await adoRes.text().catch(() => '');
      log.warn(`ADO upload ${adoRes.status} ${url} | ${text.slice(0, 200)}`);
      throw new Error(text);
    }
    if (adoRes.status === 204) return null;

    let data;
    try {
      data = await adoRes.json();
    } catch {
      throw new Error('ADO returned non-JSON response');
    }
    return data;
  }

  return { callAdoProxy, uploadAdoProxy };
}

/** @typedef {ReturnType<typeof createAdoProxyService>} AdoProxyService */
