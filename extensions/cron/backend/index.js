/**
 * extensions/cron/backend/index.js — Cron plugin backend activation entry
 *
 * Registers all cron API methods and the fired-event stream via
 * BackendPluginHost.  Delegates to the cron-manager for job scheduling.
 *
 * Business API methods:
 *   listJobs, createJob, restoreJobs, updateJob, deleteJob, pauseJob, resumeJob
 *
 * Stream:
 *   fired - pushes { sessionId, jobId, prompt } when a cron job fires
 */

/** @import { BackendPluginHost } from '@agent-type' */

import * as manager from './cron-manager/index.js';

export function activate(host) {
  const log = host.logger;

  // The cron manager is purely in-memory — no file persistence.
  // All job definitions are owned by the frontend snapshot and
  // re-registered on every onReady via restoreJobs.
  manager.init(log);
  log.info('cron plugin activated');

  // ── RPC APIs ───────────────────────────────────────────────────────────

  host.defineApi('listJobs', async (params) => {
    const sessionId = params?.sessionId;
    if (!sessionId) throw new Error('sessionId is required');
    const jobs = manager.listJobs(sessionId).map(manager.serializeJob);
    return { jobs };
  });

  host.defineApi('createJob', async (params) => {
    const { sessionId, cronExpr, prompt, recurring, label } = params || {};
    if (!sessionId) throw new Error('sessionId is required');
    if (!cronExpr) throw new Error('cronExpr is required');
    if (!prompt) throw new Error('prompt is required');
    const job = manager.createJob({ sessionId, cronExpr, prompt, recurring, label });
    return manager.serializeJob(job);
  });

  host.defineApi('restoreJobs', async (params) => {
    const { sessionId, jobs } = params || {};
    if (!sessionId) throw new Error('sessionId is required');
    if (!Array.isArray(jobs)) throw new Error('jobs array is required');
    manager.restoreJobs(sessionId, jobs);
    const refreshed = manager.listJobs(sessionId).map(manager.serializeJob);
    return { jobs: refreshed };
  });

  host.defineApi('updateJob', async (params) => {
    const { id, sessionId, patch } = params || {};
    if (!id) throw new Error('id is required');
    if (!sessionId) throw new Error('sessionId is required');
    const job = manager.updateJob(id, sessionId, patch || {});
    if (!job) throw new Error('Job "' + id + '" not found');
    return manager.serializeJob(job);
  });

  host.defineApi('deleteJob', async (params) => {
    const { id, sessionId } = params || {};
    if (!id) throw new Error('id is required');
    if (!sessionId) throw new Error('sessionId is required');
    const ok = manager.deleteJob(id, sessionId);
    if (!ok) throw new Error('Job "' + id + '" not found');
    return { success: true };
  });

  host.defineApi('pauseJob', async (params) => {
    const { id, sessionId } = params || {};
    if (!id) throw new Error('id is required');
    if (!sessionId) throw new Error('sessionId is required');
    const job = manager.pauseJob(id, sessionId);
    if (!job) throw new Error('Job "' + id + '" not found');
    return manager.serializeJob(job);
  });

  host.defineApi('resumeJob', async (params) => {
    const { id, sessionId } = params || {};
    if (!id) throw new Error('id is required');
    if (!sessionId) throw new Error('sessionId is required');
    const job = manager.resumeJob(id, sessionId);
    if (!job) throw new Error('Job "' + id + '" not found or already completed');
    return manager.serializeJob(job);
  });

  // ── Fired-event stream ─────────────────────────────────────────────────

  host.defineStream('fired', (params, io) => {
    const sessionId = params?.sessionId;
    if (!sessionId) {
      io.sendJSON({ _error: 'sessionId is required' });
      io.onClose(() => {});
      return { subscribe: () => ({ unsubscribe: () => {} }) };
    }

    const unsub = manager.subscribe(sessionId, (jobId, prompt) => {
      if (io.isConnected()) {
        io.sendJSON({ jobId, prompt });
      }
    });

    const heartbeat = setInterval(() => {
      if (io.isConnected()) {
        io.sendJSON({ _heartbeat: true });
      }
    }, 30_000);

    io.onClose(() => {
      clearInterval(heartbeat);
      unsub();
    });

    return {
      onClientMessage: undefined,
      subscribe: () => ({
        unsubscribe: () => {
          clearInterval(heartbeat);
          unsub();
        },
      }),
    };
  });
}

/**
 * Deactivate hook — called by the plugin lifecycle when the plugin is
 * disabled or uninstalled.  Stops all cron timers and subscriptions.
 * Symmetric to activate(host).
 */
export function deactivate() {
  manager.shutdown();
}
