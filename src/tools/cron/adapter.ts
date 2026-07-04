import type { CronJob, CronManagerAdapter, HttpCronAdapterConfig } from './types';

// ── HTTP adapter factory ───────────────────────────────────────────────────────

/**
 * Creates a `CronManagerAdapter` that communicates with the Agent SDK
 * backend over HTTP REST and SSE.
 *
 * @example
 * ```ts
 * const cronToolSet = createCronToolSet(
 *   createHttpCronAdapter({ baseUrl: '/api' }),
 * );
 * ```
 */
export function createHttpCronAdapter(
  config?: HttpCronAdapterConfig,
): CronManagerAdapter {
  const base = (config?.baseUrl ?? '/api').replace(/\/$/, '');

  // ── Shared single SSE connection (all sessions of this adapter instance) ──
  // Instead of one EventSource per session, a single connection to
  // /api/cron/stream/all multiplexes events for every sessionId.
  // This avoids hitting the browser's HTTP/1.1 per-host connection cap.
  const _handlers = new Map<string, (jobId: string, prompt: string) => void>();
  let _globalEs: EventSource | null = null;
  let _retryTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureGlobalSse() {
    if (_globalEs) return;
    const url = `${base}/cron/stream/all`;
    _globalEs = new EventSource(url);

    _globalEs.addEventListener('fired', (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as { sessionId: string; jobId: string; prompt: string };
        if (msg.sessionId && msg.jobId && msg.prompt) {
          try {
            _handlers.get(msg.sessionId)?.(msg.jobId, msg.prompt);
          } catch {
            // handler error — swallow so the SSE connection remains healthy
          }
        }
      } catch {
        // malformed event — ignore
      }
    });

    _globalEs.addEventListener('heartbeat', () => { /* keep-alive, noop */ });

    _globalEs.onerror = () => {
      _globalEs?.close();
      _globalEs = null;
      // Reconnect only when there are active listeners.
      if (_handlers.size > 0) {
        _retryTimer = setTimeout(ensureGlobalSse, 1500);
      }
    };
  }
  // ─────────────────────────────────────────────────────────────────────────

  async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  return {
    async listJobs({ sessionId }) {
      const raw = await apiFetch<{ jobs: CronJob[] }>(
        `/cron?sessionId=${encodeURIComponent(sessionId)}`,
      );
      return raw.jobs;
    },

    async createJob({ sessionId, cronExpr, prompt, recurring, label }) {
      return apiFetch<CronJob>('/cron', {
        method: 'POST',
        body:   JSON.stringify({ sessionId, cronExpr, prompt, recurring, label }),
      });
    },

    async updateJob(id, sessionId, patch) {
      return apiFetch<CronJob>(`/cron/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body:   JSON.stringify({ sessionId, ...patch }),
      });
    },

    async deleteJob(id, sessionId) {
      await apiFetch(
        `/cron/${encodeURIComponent(id)}?sessionId=${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
    },

    async pauseJob(id, sessionId) {
      return apiFetch<CronJob>(`/cron/${encodeURIComponent(id)}/pause`, {
        method: 'POST',
        body:   JSON.stringify({ sessionId }),
      });
    },

    async resumeJob(id, sessionId) {
      return apiFetch<CronJob>(`/cron/${encodeURIComponent(id)}/resume`, {
        method: 'POST',
        body:   JSON.stringify({ sessionId }),
      });
    },

    startListening(sessionId, onFired) {
      // All sessions of this adapter share a SINGLE EventSource connection to
      // /api/cron/stream/all.  The server multiplexes events for every session
      // over that one connection, so we never hit the browser's HTTP/1.1
      // per-host connection limit (6) regardless of how many sessions are open.

      _handlers.set(sessionId, onFired);
      ensureGlobalSse();

      return () => {
        _handlers.delete(sessionId);
        // When the last session unregisters, tear down the shared connection.
        if (_handlers.size === 0) {
          if (_retryTimer !== null) { clearTimeout(_retryTimer); _retryTimer = null; }
          _globalEs?.close();
          _globalEs = null;
        }
      };
    },
  };
}
