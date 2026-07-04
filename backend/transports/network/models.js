/**
 * GET /api/models?provider=xxx
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Parses query → calls service → sends HTTP response.
 */

import { send } from '../../lib/http.js';
import { listModels } from '../../services/models.js';

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} path
 * @returns {Promise<boolean>} false if route did not match
 */
export async function handleModelRoutes(req, res, path) {
  if (req.method !== 'GET' || path !== '/api/models') return false;

  const url = new URL(req.url, 'http://localhost');
  const providerName = url.searchParams.get('provider');

  try {
    const result = await listModels(providerName);
    return send(res, 200, result);
  } catch (err) {
    const status = err.message.toLowerCase().includes('missing') || err.message.toLowerCase().includes('unknown') ? 400 : 502;
    return send(res, status, { error: err.message });
  }
}
