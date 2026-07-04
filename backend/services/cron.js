/**
 * backend/lib/services/cron.js — Cron business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here: validation, formatting, error handling.
 */

import {
  createJob,
  deleteJob,
  pauseJob,
  resumeJob,
  listJobs,
  getJob,
  serializeJob,
  subscribe,
  subscribeAll,
} from '../lib/cron-manager/index.js';

export function listCronJobs({ sessionId }) {
  if (!sessionId) throw new Error('sessionId is required');
  const jobs = listJobs(sessionId).map(serializeJob);
  return { jobs };
}

export function getSingleCronJob({ id }) {
  if (!id) throw new Error('id is required');
  const job = getJob(id);
  if (!job) throw new Error(`Job "${id}" not found`);
  return serializeJob(job);
}

export function createCronJob({ sessionId, cronExpr, prompt, recurring, label }) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!cronExpr) throw new Error('cronExpr is required');
  if (!prompt) throw new Error('prompt is required');
  const job = createJob({ sessionId, cronExpr, prompt, recurring, label });
  return serializeJob(job);
}

export function pauseCronJob({ id }) {
  if (!id) throw new Error('id is required');
  const job = pauseJob(id);
  if (!job) throw new Error(`Job "${id}" not found`);
  return serializeJob(job);
}

export function resumeCronJob({ id }) {
  if (!id) throw new Error('id is required');
  const job = resumeJob(id);
  if (!job) throw new Error(`Job "${id}" not found or already completed`);
  return serializeJob(job);
}

export function deleteCronJob({ id, sessionId }) {
  if (!id) throw new Error('id is required');
  const result = deleteJob(id, sessionId);
  if (!result) throw new Error(`Job "${id}" not found`);
  return { success: true };
}

/**
 * Subscribe to cron-job fire events for a specific session.
 * @param {{ sessionId: string, onFired: (jobId: string, prompt: string) => void }} opts
 * @returns {() => void} Unsubscribe function
 */
export function subscribeCronEvents({ sessionId, onFired }) {
  if (!sessionId) throw new Error('sessionId is required');
  return subscribe(sessionId, onFired);
}

/**
 * Subscribe to all cron-job fire events across all sessions.
 * @param {{ onFired: (sessionId: string, jobId: string, prompt: string) => void }} opts
 * @returns {() => void} Unsubscribe function
 */
export function subscribeAllCronEvents({ onFired }) {
  return subscribeAll(onFired);
}
