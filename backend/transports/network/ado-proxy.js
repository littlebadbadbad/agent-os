/**
 * ADO reverse-proxy routes — keeps PAT and ADO traffic off the browser.
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: parse HTTP request → call service → send HTTP response.
 */

import { send } from '../../lib/http.js';
import { callAdoProxy, uploadAdoProxy } from '../../services/ado-proxy.js';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export async function handleAdoProxyRoutes(req, res, path) {

  // ── POST /api/ado-proxy  (JSON envelope) ────────────────────────────────────
  if (req.method === 'POST' && path === '/api/ado-proxy') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return send(res, 400, { error: 'Invalid JSON body' });
    }

    // PAT & API version come via headers (never in the JSON envelope) —
    // merge them into the body so the service layer gets them.
    body.pat = req.headers['x-ado-pat'] ?? body.pat;
    body.apiVersion = req.headers['x-ado-api-version'] ?? body.apiVersion;

    try {
      const result = await callAdoProxy(body);
      return send(res, result === null ? 200 : 200, result);
    } catch (err) {
      return send(res, 502, { error: err.message });
    }
  }

  // ── POST /api/ado-proxy/upload  (raw binary body) ───────────────────────────
  if (req.method === 'POST' && path === '/api/ado-proxy/upload') {
    const url          = req.headers['x-ado-target-url'];
    const pat          = req.headers['x-ado-pat'];
    const contentType  = req.headers['x-ado-content-type'] ?? 'application/octet-stream';
    const apiVersion   = req.headers['x-ado-api-version'];

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    try {
      const result = await uploadAdoProxy({ url, pat, contentType, apiVersion, rawBody });
      return send(res, result === null ? 200 : 200, result);
    } catch (err) {
      return send(res, 502, { error: err.message });
    }
  }

  return false;
}
