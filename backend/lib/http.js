/**
 * Shared HTTP helpers for all route handlers.
 */

/** Read and JSON-parse the request body. */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/** Write a JSON response. */
export function send(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Apply permissive CORS headers (demo only — restrict in production). */
export function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Map a service error to the appropriate HTTP response.
 * Convention: service functions throw descriptive Error objects.
 *   - validation failures → 400
 *   - "not found", "not exist" → 404
 *   - "already in flight" → 409
 *   - tool execution errors → 422
 *   - everything else → 500
 */
export function sendServiceError(res, err) {
  const msg = err.message;
  if (/(?:required|must|Invalid|valid|kebab-case|not allowed|traversal|export|contain|non-empty)/.test(msg)) return send(res, 400, { error: msg });
  if (/(?:not found|not exist)/.test(msg)) return send(res, 404, { error: msg });
  if (/already/.test(msg)) return send(res, 409, { error: msg });
  if (/executeTool|division by zero/.test(err.stack || msg)) return send(res, 422, { error: msg });
  return send(res, 500, { error: msg });
}
