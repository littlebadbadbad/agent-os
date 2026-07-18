/**
 * /api/model-config route handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: parse HTTP request → call service → send HTTP response.
 *
 * Endpoints:
 *   GET  /api/model-config                — read the MERGED config (built-in + custom)
 *   GET  /api/model-config/built-in       — read the BUILT-IN config only
 *   GET  /api/model-config/custom         — read the CUSTOM config only
 *   PUT  /api/model-config/custom         — overwrite the entire CUSTOM config
 *   POST /api/model-config/custom/add     — add a new custom provider entry
 *   POST /api/model-config/custom/remove  — remove a custom provider by name
 *   POST /api/model-config/custom/update  — update (replace) a custom provider by name
 */

import { readBody, send } from '../../lib/http.js';
import * as modelConfigService from '../../services/model-config.js';

/** @import { IncomingMessage, ServerResponse } from 'http' */

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse}  res
 * @param {string} path
 * @returns {boolean|Promise<boolean>} false if route did not match
 */
export async function handleModelConfigRoutes(req, res, path) {
  // GET /api/model-config — read MERGED config
  if (req.method === 'GET' && path === '/api/model-config') {
    try {
      return send(res, 200, modelConfigService.getMergedConfig());
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  // GET /api/model-config/built-in — read BUILT-IN config
  if (req.method === 'GET' && path === '/api/model-config/built-in') {
    try {
      return send(res, 200, modelConfigService.getBuiltInConfig());
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  // GET /api/model-config/custom — read CUSTOM config
  if (req.method === 'GET' && path === '/api/model-config/custom') {
    try {
      return send(res, 200, modelConfigService.getCustomConfig());
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  // PUT /api/model-config/custom — overwrite entire CUSTOM config
  if (req.method === 'PUT' && path === '/api/model-config/custom') {
    const body = await readBody(req);
    try {
      modelConfigService.saveCustomConfig(body);
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // POST /api/model-config/custom/add — add a custom provider
  if (req.method === 'POST' && path === '/api/model-config/custom/add') {
    const body = await readBody(req);
    try {
      modelConfigService.addCustomProvider(body);
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // POST /api/model-config/custom/remove — remove a custom provider
  if (req.method === 'POST' && path === '/api/model-config/custom/remove') {
    const body = await readBody(req);
    try {
      modelConfigService.removeCustomProvider(body.name);
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // POST /api/model-config/custom/update — update (replace) a custom provider
  if (req.method === 'POST' && path === '/api/model-config/custom/update') {
    const body = await readBody(req);
    try {
      if (!body.name) {
        return send(res, 400, { error: 'name is required' });
      }
      modelConfigService.updateCustomProvider(body.name, body.entry);
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  return false;
}
