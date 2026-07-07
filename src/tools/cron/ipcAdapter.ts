/**
 * src/tools/cron/ipcAdapter.ts — Electron IPC adapter for cron operations
 *
 * Uses window.electronAPI.invoke() and on() for event listening
 * instead of HTTP + SSE.
 */

import type { CronJob, CronManagerAdapter } from './types';

/** No config needed — IPC channel names are fixed at build time. */
export type IpcCronAdapterConfig = Record<string, never>;

// ── IPC adapter factory ───────────────────────────────────────────────────────

/**
 * Creates a `CronManagerAdapter` that communicates with the Agent SDK
 * backend over Electron IPC instead of HTTP REST + SSE.
 *
 * @example
 * ```ts
 * const cronToolSet = createCronToolSet(
 *   createIpcCronAdapter(),
 * );
 * ```
 */
export function createIpcCronAdapter(
  _config?: IpcCronAdapterConfig,
): CronManagerAdapter {
  const invoke = window.electronAPI?.invoke;
  const onEvent = window.electronAPI?.on;
  if (!invoke) {
    throw new Error('createIpcCronAdapter: window.electronAPI.invoke is not available');
  }

  // Per-session handlers — stores cleanup functions keyed by sessionId.
  const _cleanups = new Map<string, () => void>();

  // Cap on active cron:fired listeners to prevent EventEmitter memory leak.
  // Beyond this many distinct sessions, oldest listeners are recycled.
  const MAX_LISTENERS = 10;

  return {
    async listJobs({ sessionId }) {
      const raw = await invoke('cron:list', { sessionId }) as { jobs: CronJob[] };
      return raw.jobs;
    },

    async createJob({ sessionId, cronExpr, prompt, recurring, label }) {
      return invoke('cron:create', { sessionId, cronExpr, prompt, recurring, label }) as Promise<CronJob>;
    },

    async updateJob(id, sessionId, patch) {
      return invoke('cron:update', { id, sessionId, patch }) as Promise<CronJob>;
    },

    async deleteJob(id, sessionId) {
      await invoke('cron:delete', { id, sessionId });
    },

    async pauseJob(id, sessionId) {
      return invoke('cron:pause', { id, sessionId }) as Promise<CronJob>;
    },

    async resumeJob(id, sessionId) {
      return invoke('cron:resume', { id, sessionId }) as Promise<CronJob>;
    },

    startListening(sessionId, onFired) {
      if (!onEvent) {
        throw new Error('createIpcCronAdapter: window.electronAPI.on is not available');
      }

      // Clean up any existing listener for this session before re-registering.
      const existing = _cleanups.get(sessionId);
      if (existing) {
        existing();
      }

      // Enforce global listener cap: recycle the oldest non-current session.
      if (_cleanups.size >= MAX_LISTENERS) {
        for (const [sid, cleanup] of _cleanups) {
          if (sid !== sessionId) {
            cleanup();
            break;
          }
        }
        console.warn(
          `[createIpcCronAdapter] Reached ${MAX_LISTENERS} active cron:fired listeners; ` +
          `recycled oldest session. This suggests cron listeners are not being ` +
          `cleaned up properly.`,
        );
      }

      // Start listening in main process.
      invoke('cron:startListening', { sessionId }).catch(() => {});

      // Listen for fired events — filter by sessionId so each session
      // only receives its own cron jobs.
      const unsub = onEvent('cron:fired', (({ jobId, prompt, sessionId: eventSessionId }: { jobId: string; prompt: string; sessionId: string }) => {
        if (eventSessionId === sessionId) {
          onFired(jobId, prompt);
        }
      }) as (...args: unknown[]) => void);

      const cleanup = () => {
        unsub();
        invoke('cron:stopListening', { sessionId }).catch(() => {});
        _cleanups.delete(sessionId);
      };

      _cleanups.set(sessionId, cleanup);

      return cleanup;
    },
  };
}
