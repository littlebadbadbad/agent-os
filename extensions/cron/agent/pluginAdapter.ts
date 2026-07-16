/**
 * extensions/cron/agent/pluginAdapter.ts — Cron backend adapter
 *
 * Wraps the PluginApiClient (pre-bound to the cron plugin) into a
 * CronManagerAdapter that the ToolSet and panel consume.
 *
 * Unlike the old HTTP/IPC adapters in src/tools/cron/, this adapter
 * is environment-agnostic — PluginApiClient handles HTTP ↔ IPC
 * routing transparently.
 */

import type { PluginApiClient } from '@agent-type';
import type { CronJob, CronManagerAdapter } from './types';

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCronPluginAdapter(apiClient: PluginApiClient): CronManagerAdapter {
  // Per-session fired-event cleanup functions.
  const cleanups = new Map<string, () => void>();

  return {
    async listJobs({ sessionId }) {
      const raw = await apiClient.call<{ jobs: CronJob[] }>('listJobs', { sessionId });
      return raw.jobs;
    },

    async createJob({ sessionId, cronExpr, prompt, recurring, label }) {
      return apiClient.call<CronJob>('createJob', {
        sessionId, cronExpr, prompt, recurring, label,
      });
    },

    async updateJob(id, sessionId, patch) {
      return apiClient.call<CronJob>('updateJob', { id, sessionId, patch });
    },

    async deleteJob(id, sessionId) {
      await apiClient.call('deleteJob', { id, sessionId });
    },

    async pauseJob(id, sessionId) {
      return apiClient.call<CronJob>('pauseJob', { id, sessionId });
    },

    async resumeJob(id, sessionId) {
      return apiClient.call<CronJob>('resumeJob', { id, sessionId });
    },

    startListening(sessionId, onFired) {
      // Close any existing listener for this session before re-registering.
      const existing = cleanups.get(sessionId);
      if (existing) existing();

      const stream = apiClient.connectStream('fired', { sessionId });
      stream.callbacks.onData = (data) => {
        const msg = data as { jobId: string; prompt: string };
        if (msg.jobId && msg.prompt) {
          onFired(msg.jobId, msg.prompt);
        }
      };
      const sub = stream.subscribe();

      const cleanup = () => {
        sub.unsubscribe();
        cleanups.delete(sessionId);
      };
      cleanups.set(sessionId, cleanup);
      return cleanup;
    },
  };
}
