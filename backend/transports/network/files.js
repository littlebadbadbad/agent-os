/**
 * File routes — PURE PROTOCOL LAYER.
 *
 * Only: extract params → call service → send result.
 * Zero business logic, zero validation, zero error formatting.
 */

import { readBody, send } from '../../lib/http.js';
import * as fileService from '../../services/files.js';

export async function handleFileRoutes(req, res, path) {
  if (req.method === 'GET' && path === '/api/files/read') {
    const url = new URL(req.url, 'http://localhost');
    return send(res, 200, await fileService.readFile({
      path: url.searchParams.get('path') ?? '',
      startLine: url.searchParams.has('startLine') ? parseInt(url.searchParams.get('startLine'), 10) : undefined,
      endLine: url.searchParams.has('endLine') ? parseInt(url.searchParams.get('endLine'), 10) : undefined,
    }));
  }

  if (req.method === 'POST' && path === '/api/files/write') {
    return send(res, 200, await fileService.writeFile(await readBody(req)));
  }

  if (req.method === 'POST' && path === '/api/files/str-replace') {
    return send(res, 200, await fileService.replaceInFile(await readBody(req)));
  }

  if (req.method === 'POST' && path === '/api/files/replace-all') {
    return send(res, 200, await fileService.replaceAllInFile(await readBody(req)));
  }

  if (req.method === 'DELETE' && path === '/api/files/delete') {
    const url = new URL(req.url, 'http://localhost');
    return send(res, 200, fileService.deleteFile({ path: url.searchParams.get('path') ?? '' }));
  }

  if (req.method === 'POST' && path === '/api/files/move') {
    return send(res, 200, fileService.moveFile(await readBody(req)));
  }

  if (req.method === 'GET' && path === '/api/files/list') {
    const url = new URL(req.url, 'http://localhost');
    return send(res, 200, await fileService.listDirectory({
      path: url.searchParams.get('path') ?? '',
      depth: url.searchParams.has('depth') ? parseInt(url.searchParams.get('depth'), 10) : 1,
    }));
  }

  if (req.method === 'GET' && path === '/api/files/search') {
    const url = new URL(req.url, 'http://localhost');
    return send(res, 200, await fileService.searchFiles({
      pattern: url.searchParams.get('pattern') ?? '**',
      content: url.searchParams.get('content') ?? '',
      maxResults: url.searchParams.has('max') ? parseInt(url.searchParams.get('max'), 10) : 50,
      caseSensitive: url.searchParams.get('caseSensitive') === 'true',
      contextLines: url.searchParams.has('contextLines') ? parseInt(url.searchParams.get('contextLines'), 10) : 0,
      outputMode: url.searchParams.get('outputMode') ?? 'files',
    }));
  }

  if (req.method === 'GET' && path === '/api/files/workspace') {
    return send(res, 200, { root: fileService.getWorkspaceRootPath() });
  }

  if (req.method === 'POST' && path === '/api/files/workspace') {
    return send(res, 200, fileService.setWorkspaceRootPath(await readBody(req)));
  }

  // ── GET /api/files/browse — filesystem browser ──────────────────────────────
  if (req.method === 'GET' && path === '/api/files/browse') {
    const url = new URL(req.url, 'http://localhost');
    try {
      const result = await fileService.browseDirectory(url.searchParams.get('path') ?? '');
      return send(res, 200, result);
    } catch (err) {
      return send(res, 400, { error: `Cannot read directory: ${err.message}` });
    }
  }

  return false;
}
