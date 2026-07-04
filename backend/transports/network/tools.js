/**
 * Tool routes — PURE PROTOCOL LAYER.
 *
 * Only: extract params → call service → send result.
 * Zero business logic, zero validation, zero error formatting.
 */

import { readBody, send, sendServiceError } from '../../lib/http.js';
import * as toolService from '../../services/tools.js';

export async function handleToolRoutes(req, res, path) {
  if (req.method === 'GET' && path === '/api/tools') {
    try {
      return send(res, 200, toolService.getToolsList());
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'POST' && path === '/api/tools') {
    try {
      return send(res, 201, toolService.createTool(await readBody(req)));
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'PATCH' && path.startsWith('/api/tools/')) {
    const name = decodeURIComponent(path.slice('/api/tools/'.length));
    try {
      return send(res, 200, toolService.updateTool({ name, patch: await readBody(req) }));
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'DELETE' && path.startsWith('/api/tools/')) {
    const name = decodeURIComponent(path.slice('/api/tools/'.length));
    try {
      return send(res, 200, toolService.deleteTool({ name }));
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'POST' && path === '/api/execute-tool') {
    const body = await readBody(req);
    const { name, arguments: args = {}, sessionId, agentName, conversationId } = body;
    try {
      const result = await toolService.runTool({ name, args, ctx: { sessionId, agentName, conversationId } });
      return send(res, 200, result);
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'GET' && path === '/api/tool-modules') {
    try {
      return send(res, 200, toolService.getModulesList());
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'POST' && path === '/api/tool-modules') {
    try {
      return send(res, 201, toolService.createToolModule(await readBody(req)));
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'GET' && path.startsWith('/api/tool-modules/')) {
    const name = decodeURIComponent(path.slice('/api/tool-modules/'.length));
    try {
      return send(res, 200, toolService.getToolModule({ name }));
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'PATCH' && path.startsWith('/api/tool-modules/')) {
    const name = decodeURIComponent(path.slice('/api/tool-modules/'.length));
    try {
      return send(res, 200, toolService.updateToolModule({ name, patch: await readBody(req) }));
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'DELETE' && path.startsWith('/api/tool-modules/')) {
    const name = decodeURIComponent(path.slice('/api/tool-modules/'.length));
    try {
      return send(res, 200, toolService.deleteToolModule({ name }));
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'GET' && path === '/api/tool-deps') {
    try {
      return send(res, 200, toolService.getDepsList());
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'POST' && path === '/api/tool-deps/install') {
    try {
      const result = await toolService.installToolDeps(await readBody(req));
      if (result && result.success === false) return send(res, 422, result);
      return send(res, 200, result);
    } catch (err) { return sendServiceError(res, err); }
  }
  if (req.method === 'DELETE' && path.startsWith('/api/tool-deps/')) {
    const pkg = decodeURIComponent(path.slice('/api/tool-deps/'.length));
    try {
      const result = await toolService.removeToolDep({ pkg });
      if (result && result.success === false) return send(res, 422, result);
      return send(res, 200, result);
    } catch (err) { return sendServiceError(res, err); }
  }
  return false;
}
