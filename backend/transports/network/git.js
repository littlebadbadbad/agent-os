/**
 * Git routes — PURE PROTOCOL LAYER.
 *
 * Only: extract params → call service → send result.
 * Zero business logic, zero validation, zero error formatting.
 */

import { readBody, send, sendServiceError } from '../../lib/http.js';
import * as gitService from '../../services/git.js';

export async function handleGitRoutes(req, res, path) {
  if (!path.startsWith('/api/git/')) return false;

  if (req.method === 'GET' && path === '/api/git/status') {
    try {
      return send(res, 200, await gitService.getGitStatus());
    } catch (err) { return sendServiceError(res, err); }
  }

  if (req.method === 'GET' && path === '/api/git/diff') {
    const url = new URL(`http://x${req.url}`);
    try {
      return send(res, 200, await gitService.getGitDiff({
        staged: url.searchParams.get('staged') === 'true',
        paths: url.searchParams.get('paths')?.split(',').map((p) => p.trim()).filter(Boolean),
      }));
    } catch (err) { return sendServiceError(res, err); }
  }

  if (req.method === 'GET' && path === '/api/git/log') {
    const url = new URL(`http://x${req.url}`);
    try {
      return send(res, 200, await gitService.getGitLog({ limit: url.searchParams.get('limit') }));
    } catch (err) { return sendServiceError(res, err); }
  }

  if (req.method === 'POST' && path === '/api/git/stage') {
    const { paths } = await readBody(req);
    try {
      return send(res, 200, await gitService.stageGit({ paths }));
    } catch (err) { return sendServiceError(res, err); }
  }

  if (req.method === 'POST' && path === '/api/git/unstage') {
    const { paths } = await readBody(req);
    try {
      return send(res, 200, await gitService.unstageGit({ paths }));
    } catch (err) { return sendServiceError(res, err); }
  }

  if (req.method === 'POST' && path === '/api/git/commit') {
    const { message } = await readBody(req);
    try {
      return send(res, 200, await gitService.commitGit({ message }));
    } catch (err) { return sendServiceError(res, err); }
  }

  if (req.method === 'POST' && path === '/api/git/discard') {
    const { paths } = await readBody(req);
    try {
      return send(res, 200, await gitService.discardGit({ paths }));
    } catch (err) { return sendServiceError(res, err); }
  }

  return false;
}
