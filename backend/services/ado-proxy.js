/**
 * backend/lib/services/ado-proxy.js — ADO reverse-proxy business logic
 *
 * Centralises URL validation, PAT decryption, auth-header creation, HTTP
 * forwarding, binary-body normalisation, and error translation so that
 * HTTP routes and IPC handlers are pure protocol passthroughs.
 *
 * Both transports call the same two functions with the same semantics.
 */

import { Agent, fetch as undiciFetch } from 'undici';
import { decryptPat } from '../lib/rsa.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ado-proxy-service');

// ── Direct (no-proxy) dispatcher — ADO traffic always goes straight out ───────
// regardless of the global ProxyAgent configured in lib/proxy.js.
const directAgent = new Agent();

const DEFAULT_API_VERSION = '6.1-preview';

// ── Internal helpers ──────────────────────────────────────────────────────────

function makeAuthHeader(pat) {
  return 'Basic ' + Buffer.from(':' + pat).toString('base64');
}

function withApiVersion(url, apiVersion) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}api-version=${apiVersion ?? DEFAULT_API_VERSION}`;
}

/**
 * Validate that the target URL is a valid https:// URL (SSRF prevention).
 *
 * @param {string} url
 * @returns {string|null} error message or null if valid
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') return 'url is required';
  if (!url.startsWith('https://')) return 'url must start with https://';
  return null;
}

/**
 * Decrypt an encrypted PAT.
 *
 * @param {string} encryptedPat - RSA-OAEP encrypted base64 PAT
 * @returns {string} plaintext PAT
 * @throws {Error} if decryption fails
 */
export function decryptPatToken(encryptedPat) {
  if (!encryptedPat || typeof encryptedPat !== 'string') {
    throw new Error('pat is required');
  }
  try {
    return decryptPat(encryptedPat);
  } catch {
    throw new Error('Failed to decrypt PAT — please refresh the page and try again');
  }
}

/**
 * Forward a JSON-envelope request to the ADO REST API.
 *
 * @param {object} params
 * @param {string} params.url          - target ADO REST URL (https://...)
 * @param {string} params.pat          - encrypted PAT
 * @param {string} [params.method]     - HTTP method (default GET)
 * @param {*}      [params.body]       - JSON-serialisable request body
 * @param {string} [params.contentType]
 * @param {string} [params.apiVersion]
 * @returns {Promise<*>} parsed JSON response (or null for 204)
 * @throws {Error} on validation failure, upstream error, or non-JSON response
 */
export async function callAdoProxy({ url, pat, method = 'GET', body, contentType, apiVersion }) {
  const urlErr = validateUrl(url);
  if (urlErr) throw new Error(urlErr);

  const plainPat = decryptPatToken(pat);
  const fullUrl = withApiVersion(url, apiVersion);
  log.debug(`→ ${method} ${url}`);

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
 *
 * IPC serialises Buffer as { type: 'Buffer', data: [...] }.
 * HTTP delivers raw bytes as Buffer (from chunk collection).
 *
 * @param {*} rawBody
 * @returns {Buffer|null}
 */
export function normaliseBinaryBody(rawBody) {
  if (!rawBody) return rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (rawBody instanceof Uint8Array) return Buffer.from(rawBody);
  if (typeof rawBody === 'object' && rawBody.type === 'Buffer') return Buffer.from(rawBody.data);
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'base64');
  return rawBody;
}

/**
 * Forward raw binary data to the ADO REST API (file uploads, etc.).
 *
 * @param {object} params
 * @param {string} params.url          - target ADO REST URL (https://...)
 * @param {string} params.pat          - encrypted PAT
 * @param {string} [params.contentType]
 * @param {string} [params.apiVersion]
 * @param {*}      params.rawBody      - Buffer, Uint8Array, {type:'Buffer',data:[...]}, or base64 string
 * @returns {Promise<*>} parsed JSON response (or null for 204)
 * @throws {Error} on validation failure, upstream error, or non-JSON response
 */
export async function uploadAdoProxy({ url, pat, contentType = 'application/octet-stream', apiVersion, rawBody }) {
  const urlErr = validateUrl(url);
  if (urlErr) throw new Error(urlErr);

  const plainPat = decryptPatToken(pat);
  const bodyBuffer = normaliseBinaryBody(rawBody);

  const fullUrl = withApiVersion(url, apiVersion);
  log.debug(`→ upload POST ${url} (${Buffer.isBuffer(bodyBuffer) ? bodyBuffer.byteLength : typeof bodyBuffer} bytes)`);

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
