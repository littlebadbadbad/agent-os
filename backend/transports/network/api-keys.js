/**
 * /api/api-keys route handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: parse HTTP request → call service → send HTTP response.
 */

import { readBody, send } from '../../lib/http.js';
import { getKeyList, saveKey, removeKey } from '../../services/api-keys.js';

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} path
 * @returns {boolean|Promise<boolean>} false if route did not match
 */
export async function handleApiKeyRoutes(req, res, path) {
  // GET /api/api-keys  — list masked keys
  if (req.method === 'GET' && path === '/api/api-keys') {
    return send(res, 200, getKeyList());
  }

  // POST /api/api-keys  — save a provider key
  if (req.method === 'POST' && path === '/api/api-keys') {
    const body = await readBody(req);
    try {
      const result = saveKey(body.providerId, body.encryptedKey);
      return send(res, 200, result);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // DELETE /api/api-keys/:providerId
  const deleteMatch = path.match(/^\/api\/api-keys\/([a-z]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    try {
      return send(res, 200, removeKey(deleteMatch[1]));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  return false;
}
