/**
 * extensions/cron/backend/cron-manager/index.js
 *
 * Cron manager — in-memory job registry backed by croner for event-driven
 * scheduling.  No file persistence: the frontend owns all job definitions
 * via its session snapshot and re-registers them on every onReady.
 *
 * The backend only holds active cron timers in memory.  When the backend
 * restarts, all jobs are gone — the frontend calls 
estoreJobs to
 * re-activate timers from the snapshot.
 *
 * Security: pause / resume / delete / update all require the caller to supply
 * the owning sessionId — mismatched operations return null / false.
 *
 * Public API:
 *   createJob   pauseJob    listJobs   subscribe      serializeJob
 *   deleteJob   resumeJob   getJob     updateJob      restoreJobs
 *   subscribeAll
 */

import { Cron } from 'croner';
import { randomBytes } from 'crypto';
import { cronToHuman } from './human.js';

/** @type {Map<string, CronJobRecord>} */
const _jobs = new Map();
/** @type {Map<string, Set<(jobId: string, prompt: string) => void>>} */
const _subscribers = new Map();
/** @type {Set<string>} */
const _inFlight = new Set();
/** @type {Set<(sessionId: string, jobId: string, prompt: string) => void>} */
const _globalSubscribers = new Set();

let _log = null;
const MAX_JOBS = 50;

export function init(logger) {
  _log = logger;
}

export function serializeJob(job) {
  const { _cron: _, _fire: _f, ...rest } = job;
  return rest;
}

function isValidCronExpr(expr) {
  try { new Cron(expr); return true; } catch { return false; }
}

function makeFireHandler(job) {
  return () => {
    if (_inFlight.has(job.id)) return;
    _inFlight.add(job.id);
    try {
      if (_log) _log.info('cron fired: ' + job.id + ' (' + job.label + ')');
      job.lastFiredAt = new Date().toISOString();
      job.fireCount += 1;
      const subs = _subscribers.get(job.sessionId);
      if (subs) { for (const fn of subs) { try { fn(job.id, job.prompt); } catch {} } }
      for (const fn of _globalSubscribers) { try { fn(job.sessionId, job.id, job.prompt); } catch {} }
      const cron = job._cron;
      const nextRun = cron ? cron.nextRun()?.toISOString() : null;
      job.nextFireAt = nextRun ?? null;
      if (nextRun === null) { job.status = 'completed'; job.completedAt = new Date().toISOString(); }
    } finally { _inFlight.delete(job.id); }
  };
}

function startCron(job) {
  if (job._cron) { job._cron.stop(); job._cron = null; }
  const handler = makeFireHandler(job);
  job._fire = handler;
  const cron = new Cron(job.cronExpr, job.recurring ? {} : { maxRuns: 1 }, handler);
  job._cron = cron;
  job.nextFireAt = cron.nextRun()?.toISOString() ?? null;
}

export function createJob({ sessionId, cronExpr, prompt, recurring, label }) {
  if (!isValidCronExpr(cronExpr)) throw new Error('Invalid cron expression: "' + cronExpr + '"');
  const activeCount = [..._jobs.values()].filter((j) => j.sessionId === sessionId && j.status !== 'completed').length;
  if (activeCount >= MAX_JOBS) throw new Error('Session has reached the maximum of ' + MAX_JOBS + ' active cron jobs');
  const id = 'cron_' + randomBytes(4).toString('hex');
  const job = { id, sessionId, label: label ?? cronToHuman(cronExpr), cronExpr, prompt, recurring: recurring !== false, status: 'active', createdAt: new Date().toISOString(), lastFiredAt: null, nextFireAt: null, completedAt: null, fireCount: 0, _cron: null };
  startCron(job);
  _jobs.set(id, job);
  if (_log) _log.ok('created cron job "' + id + '" (' + job.label + ') nextFire=' + job.nextFireAt);
  return job;
}

export function restoreJobs(sessionId, jobs) {
  for (const entry of jobs) {
    if (_jobs.has(entry.id)) continue;
    const job = { ...entry, completedAt: entry.completedAt ?? null, _cron: null };
    _jobs.set(job.id, job);
    if (job.status === 'active') {
      startCron(job);
    }
  }
  if (jobs.length > 0 && _log) _log.info('restored ' + jobs.length + ' cron job(s) from snapshot for session ' + sessionId);
}

export function updateJob(id, sessionId, patch) {
  const job = _jobs.get(id);
  if (!job) return null;
  if (job.sessionId !== sessionId) return null;
  if (job.status === 'completed') return null;
  const needsReschedule = (patch.cronExpr !== undefined && patch.cronExpr !== job.cronExpr) || (patch.recurring !== undefined && patch.recurring !== job.recurring);
  if (patch.cronExpr !== undefined) {
    if (!isValidCronExpr(patch.cronExpr)) throw new Error('Invalid cron expression: "' + patch.cronExpr + '"');
    job.cronExpr = patch.cronExpr;
    if (patch.label === undefined) job.label = cronToHuman(patch.cronExpr);
  }
  if (patch.label !== undefined) job.label = patch.label;
  if (patch.prompt !== undefined) job.prompt = patch.prompt;
  if (patch.recurring !== undefined) job.recurring = patch.recurring;
  if (needsReschedule && job.status === 'active') startCron(job);
  if (_log) _log.info('updated cron job "' + id + '"');
  return job;
}

export function deleteJob(id, sessionId) {
  const job = _jobs.get(id);
  if (!job) { if (_log) _log.info('deleteJob: "' + id + '" already gone'); return true; }
  if (sessionId !== undefined && job.sessionId !== sessionId) return false;
  if (job._cron) { job._cron.stop(); job._cron = null; }
  _jobs.delete(id);
  if (_log) _log.info('deleted cron job "' + id + '"');
  return true;
}

export function pauseJob(id, sessionId) {
  const job = _jobs.get(id);
  if (!job) return null;
  if (sessionId !== undefined && job.sessionId !== sessionId) return null;
  if (job.status === 'paused') return job;
  if (job._cron) { job._cron.stop(); job._cron = null; }
  job.status = 'paused';
  job.nextFireAt = null;
  if (_log) _log.info('paused cron job "' + id + '"');
  return job;
}

export function resumeJob(id, sessionId) {
  const job = _jobs.get(id);
  if (!job || job.status === 'completed') return null;
  if (sessionId !== undefined && job.sessionId !== sessionId) return null;
  if (!isValidCronExpr(job.cronExpr)) return null;
  startCron(job);
  job.status = 'active';
  if (_log) _log.info('resumed cron job "' + id + '" nextFire=' + job.nextFireAt);
  return job;
}

export function listJobs(sessionId) {
  return [..._jobs.values()].filter((j) => j.sessionId === sessionId);
}

export function getJob(id) {
  return _jobs.get(id);
}

export function subscribe(sessionId, fn) {
  _subscribers.set(sessionId, new Set([fn]));
  return () => {
    const subs = _subscribers.get(sessionId);
    if (subs) { subs.delete(fn); if (subs.size === 0) _subscribers.delete(sessionId); }
  };
}

export function subscribeAll(fn) {
  _globalSubscribers.add(fn);
  return () => _globalSubscribers.delete(fn);
}

export function shutdown() {
  for (const job of _jobs.values()) { if (job._cron) { job._cron.stop(); job._cron = null; } }
}

process.on('exit', shutdown);
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
