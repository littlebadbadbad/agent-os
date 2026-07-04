/**
 * Cron routes — PURE PROTOCOL LAYER.
 *
 * Only: extract params → call service → send result.
 * Zero business logic, zero validation, zero error formatting.
 *
 * SSE endpoints (/stream, /stream/all) are inherently transport-specific
 * (writeHead, Keep-Alive, heartbeat, req.on('close')). They stay here but
 * call service functions for business logic.
 */

import { readBody, send, sendServiceError } from '../../lib/http.js';
import * as cronService from '../../services/cron.js';

export async function handleCronRoutes(req, res, path) {

  // ── GET /api/cron/stream — SSE fired-event stream ────────────────────────
  if (req.method === 'GET' && path === '/api/cron/stream') {
    const url       = new URL(req.url, 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) return send(res, 400, { error: 'sessionId query param required' });

    res.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1500\n\n');

    const heartbeat = setInterval(() => {
      res.write('event: heartbeat\ndata: {}\n\n');
    }, 30_000);

    const unsub = cronService.subscribeCronEvents({
      sessionId,
      onFired: (jobId, prompt) => {
        res.write(`event: fired\ndata: ${JSON.stringify({ jobId, prompt })}\n\n`);
      },
    });

    req.on('close', () => { clearInterval(heartbeat); unsub(); });
    return;
  }

  // ── GET /api/cron/stream/all — global SSE ────────────────────────────────
  if (req.method === 'GET' && path === '/api/cron/stream/all') {
    res.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1500\n\n');

    const heartbeat = setInterval(() => {
      res.write('event: heartbeat\ndata: {}\n\n');
    }, 30_000);

    const unsubAll = cronService.subscribeAllCronEvents({
      onFired: (sessionId, jobId, prompt) => {
        res.write(`event: fired\ndata: ${JSON.stringify({ sessionId, jobId, prompt })}\n\n`);
      },
    });

    req.on('close', () => { clearInterval(heartbeat); unsubAll(); });
    return;
  }

  // ── GET /api/cron — list ─────────────────────────────────────────────────
  if (req.method === 'GET' && path === '/api/cron') {
    const url = new URL(req.url, 'http://localhost');
    try {
      return send(res, 200, cronService.listCronJobs({ sessionId: url.searchParams.get('sessionId') }));
    } catch (err) { return sendServiceError(res, err); }
  }

  // ── POST /api/cron — create ──────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/cron') {
    const body = await readBody(req);
    try {
      return send(res, 201, cronService.createCronJob(body));
    } catch (err) { return sendServiceError(res, err); }
  }

  // ── Suffix routes: /api/cron/:id/... ────────────────────────────────────
  if (path.startsWith('/api/cron/')) {
    if (req.method === 'POST' && path.endsWith('/pause')) {
      const id = decodeURIComponent(path.slice('/api/cron/'.length, -'/pause'.length));
      try {
        return send(res, 200, cronService.pauseCronJob({ id }));
      } catch (err) { return sendServiceError(res, err); }
    }

    if (req.method === 'POST' && path.endsWith('/resume')) {
      const id = decodeURIComponent(path.slice('/api/cron/'.length, -'/resume'.length));
      try {
        return send(res, 200, cronService.resumeCronJob({ id }));
      } catch (err) { return sendServiceError(res, err); }
    }

    if (req.method === 'DELETE') {
      const id = decodeURIComponent(path.slice('/api/cron/'.length));
      try {
        return send(res, 200, cronService.deleteCronJob({ id }));
      } catch (err) { return sendServiceError(res, err); }
    }

    if (req.method === 'GET') {
      const id = decodeURIComponent(path.slice('/api/cron/'.length));
      try {
        const job = cronService.getSingleCronJob({ id });
        return send(res, 200, job);
      } catch (err) { return sendServiceError(res, err); }
    }
  }

  return false;
}
