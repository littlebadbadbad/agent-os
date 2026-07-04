/**
 * Skill routes — PURE PROTOCOL LAYER.
 *
 * Only: extract params → call service → send result.
 * Zero business logic, zero validation, zero error formatting.
 */

import { readBody, send } from '../../lib/http.js';
import * as skillService from '../../services/skills.js';

export async function handleSkillRoutes(req, res, path) {
  if (req.method === 'GET' && path === '/api/skills') {
    return send(res, 200, skillService.getSkillsList());
  }

  if (req.method === 'GET' && path.startsWith('/api/skills/')) {
    const rest = path.slice('/api/skills/'.length);

    const fileMatch = rest.match(/^([^/]+)\/file$/);
    if (fileMatch) {
      const name = decodeURIComponent(fileMatch[1]);
      const url = new URL(req.url, 'http://localhost');
      const filePath = url.searchParams.get('path');
      return send(res, 200, skillService.readSkillFileContent({ name, path: filePath }));
    }

    const name = decodeURIComponent(rest);
    return send(res, 200, skillService.getSkillInfo({ name }));
  }

  if (req.method === 'POST' && path === '/api/skills') {
    return send(res, 201, await skillService.installSkill(await readBody(req)));
  }

  if (req.method === 'POST' && path === '/api/skills/upload') {
    const zipBuffer = await readRawBody(req);
    return send(res, 201, await skillService.installSkillFromZipUpload(zipBuffer));
  }

  if (req.method === 'POST' && path.startsWith('/api/skills/refresh/')) {
    const name = decodeURIComponent(path.slice('/api/skills/refresh/'.length));
    return send(res, 200, skillService.getSkillInfo({ name }));
  }

  if (req.method === 'DELETE' && path.startsWith('/api/skills/')) {
    const name = decodeURIComponent(path.slice('/api/skills/'.length));
    return send(res, 200, skillService.removeSkillByName({ name }));
  }

  return false;
}

/** Read the raw request body as a Buffer (for binary uploads). */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
