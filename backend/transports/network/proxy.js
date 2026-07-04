/**
 * Proxy configuration and connectivity-test route handlers.
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: parse HTTP request → call service → send HTTP response.
 */

import { readBody, send } from '../../lib/http.js';
import * as proxyService from '../../services/proxy.js';

export async function handleProxyRoutes(req, res, path) {

  // GET /api/proxy ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/proxy') {
    return send(res, 200, { config: proxyService.getConfig() });
  }

  // POST /api/proxy ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/proxy') {
    const body = await readBody(req);
    try {
      return send(res, 200, proxyService.updateConfig(body));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // POST /api/proxy/test ────────────────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/proxy/test') {
    const body = await readBody(req);
    const { target = 'https://www.google.com', ...rest } = body;

    try {
      const overrides = Object.keys(rest).length > 0 ? rest : undefined;
      const result = await proxyService.testProxyTarget(target, overrides);
      return send(res, 200, result);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  return false; // route not matched
}
