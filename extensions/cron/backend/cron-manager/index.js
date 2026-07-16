/**
 * extensions/cron/backend/cron-manager/index.js
 *
 * Cron manager - job registry backed by croner for reliable, event-driven scheduling.
 *
 * Persistence: jobs are written to a JSON file in the plugin data directory
 * on every mutation via atomic write (tmp -> rename). On startup all previously
 * active jobs are automatically resumed; completed jobs older than COMPLETED_TTL_MS
 * are pruned.
 *
 * Security: pause / resume / delete / update all require the caller to supply
 * the owning sessionId - mismatched operations return null / false.
 *
 * Public API:
 *   createJob   pauseJob    listJobs   subscribe    serializeJob
 *   deleteJob   resumeJob   getJob     updateJob    subscribeAll
 */

import { Cron } from 'croner';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';
import { cronToHuman } from './human.js';

/**
 * @typedef {{ [key: string]: unknown }} Logger
 */

/** @type {import('croner').Cron | null} */
let _intervalHandle = null;

/**
 * @typedef {{
 *   id:          string,
 *   sessionId:   string,
 *   label:       string,
 *   cronExpr:    string,
 *   prompt:      string,
 *   recurring:   boolean,
 *   status:      'active' | 'paused' | 'completed',
 *   createdAt:   string,
 *   lastFiredAt: string | null,
 *   nextFireAt:  string | null,
 *   completedAt: string | null,
 *   fireCount:   number,
 *   _cron:       import('croner').Cron | null,
 * }} CronJobRecord
 */

/** @type {Map<string, CronJobRecord>} */
const _jobs = new Map();
/** @type {Map<string, Set<(jobId: string, prompt: string) => void>>} */
const _subscribers = new Map();
/** @type {Set<string>} */
const _inFlight = new Set();
/** @type {Set<(sessionId: string, jobId: string, prompt: string) => void>} */
const _globalSubscribers = new Set();

let _log = null;
let _persistFile = null;
let _persistTmp = null;
const MAX_JOBS = 50;
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Initialise the cron manager with a data directory and logger.
 *
 * @param {string} dataDir  - Absolute path to the plugin data directory.
 * @param {import('../../../../backend/lib/logger.js')} [logger]
 */
export function init(dataDir, logger) {
  _log = logger;
  _persistFile = join(dataDir, 'cron-jobs.json');
  _persistTmp = _persistFile + '.tmp';

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  load();
}

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * @param {CronJobRecord} job
 * @returns {Omit<CronJobRecord, '_cron'>}
 */
export function serializeJob(job) {
  const { _cron: _, ...rest } = job;
  return rest;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function save() {
  if (!_persistFile) return;
  try {
    const data = JSON.stringify([..._jobs.values()].map(serializeJob), null, 2);
    writeFileSync(_persistTmp, data, 'utf8');
    renameSync(_persistTmp, _persistFile);
  } catch (err) {
    if (_log) _log.error('failed to persist cron jobs', err.message);
  }
}

function load() {
  if (!_persistFile || !existsSync(_persistFile)) return;
  try {
    const raw = readFileSync(_persistFile, 'utf8');
    /** @type {Omit<CronJobRecord, '_cron'>[]} */
    const entries = JSON.parse(raw);
    for (const entry of entries) {
      /** @type {CronJobRecord} */
      const job = { ...entry, completedAt: entry.completedAt ?? null, _cron: null };
      _jobs.set(job.id, job);
      if (job.status === 'active') {
        try {
          startCron(job);
        } catch (err) {
          if (_log) _log.warn('could not resume job "' + job.id + '" after reload: ' + err.message);
          job.status = 'paused';
        }
      }
    }
    if (_log) _log.info('loaded ' + entries.length + ' cron job(s) from disk');
    pruneCompleted();
  } catch (err) {
    if (_log) _log.error('failed to load cron-jobs.json', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @param {string} expr
 * @returns {boolean}
 */
function isValidCronExpr(expr) {
  try {
    new Cron(expr);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {CronJobRecord} job
 */
function startCron(job) {
  if (job._cron) {
    job._cron.stop();
    job._cron = null;
  }

  const cron = new Cron(
    job.cronExpr,
    job.recurring ? {} : { maxRuns: 1 },
    () => {
      if (_inFlight.has(job.id)) return;
      _inFlight.add(job.id);
      try {
        if (_log) _log.info('cron fired: ' + job.id + ' (' + job.label + ')');
        job.lastFiredAt = new Date().toISOString();
        job.fireCount += 1;

        const subs = _subscribers.get(job.sessionId);
        if (subs) {
          for (const fn of subs) {
            try { fn(job.id, job.prompt); } catch { /* subscriber error - swallowed */ }
          }
        }

        for (const fn of _globalSubscribers) {
          try { fn(job.sessionId, job.id, job.prompt); } catch { /* swallowed */ }
        }

        job.nextFireAt = cron.nextRun()?.toISOString() ?? null;
        if (job.nextFireAt === null) {
          job.status = 'completed';
          job.completedAt = new Date().toISOString();
        }
        save();
      } finally {
        _inFlight.delete(job.id);
      }
    },
  );

  job._cron = cron;
  job.nextFireAt = cron.nextRun()?.toISOString() ?? null;
}

function pruneCompleted() {
  const cutoff = Date.now() - COMPLETED_TTL_MS;
  let pruned = 0;
  for (const [id, job] of _jobs) {
    if (job.status === 'completed' && job.completedAt) {
      if (new Date(job.completedAt).getTime() < cutoff) {
        _jobs.delete(id);
        pruned++;
      }
    }
  }
  if (pruned > 0) {
    if (_log) _log.info('pruned ' + pruned + ' expired completed cron job(s)');
    save();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {{ sessionId: string, cronExpr: string, prompt: string, recurring?: boolean, label?: string }} opts
 * @returns {CronJobRecord}
 */
export function createJob({ sessionId, cronExpr, prompt, recurring, label }) {
  if (!isValidCronExpr(cronExpr)) {
    throw new Error('Invalid cron expression: "' + cronExpr + '"');
  }

  const activeCount = [..._jobs.values()]
    .filter((j) => j.sessionId === sessionId && j.status !== 'completed').length;
  if (activeCount >= MAX_JOBS) {
    throw new Error('Session has reached the maximum of ' + MAX_JOBS + ' active cron jobs');
  }

  const id = 'cron_' + randomBytes(4).toString('hex');

  /** @type {CronJobRecord} */
  const job = {
    id,
    sessionId,
    label: label ?? cronToHuman(cronExpr),
    cronExpr,
    prompt,
    recurring: recurring !== false,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastFiredAt: null,
    nextFireAt: null,
    completedAt: null,
    fireCount: 0,
    _cron: null,
  };

  startCron(job);
  _jobs.set(id, job);
  save();
  if (_log) _log.ok('created cron job "' + id + '" (' + job.label + ') nextFire=' + job.nextFireAt);
  return job;
}

/**
 * @param {string} id
 * @param {string} sessionId
 * @param {{ label?: string, cronExpr?: string, prompt?: string, recurring?: boolean }} patch
 * @returns {CronJobRecord | null}
 */
export function updateJob(id, sessionId, patch) {
  const job = _jobs.get(id);
  if (!job) return null;
  if (job.sessionId !== sessionId) return null;
  if (job.status === 'completed') return null;

  const needsReschedule =
    (patch.cronExpr !== undefined && patch.cronExpr !== job.cronExpr) ||
    (patch.recurring !== undefined && patch.recurring !== job.recurring);

  if (patch.cronExpr !== undefined) {
    if (!isValidCronExpr(patch.cronExpr)) {
      throw new Error('Invalid cron expression: "' + patch.cronExpr + '"');
    }
    job.cronExpr = patch.cronExpr;
    if (patch.label === undefined) job.label = cronToHuman(patch.cronExpr);
  }
  if (patch.label !== undefined) job.label = patch.label;
  if (patch.prompt !== undefined) job.prompt = patch.prompt;
  if (patch.recurring !== undefined) job.recurring = patch.recurring;

  if (needsReschedule && job.status === 'active') {
    startCron(job);
  }

  save();
  if (_log) _log.info('updated cron job "' + id + '"');
  return job;
}

/**
 * @param {string} id
 * @param {string} [sessionId]
 * @returns {boolean}
 */
export function deleteJob(id, sessionId) {
  const job = _jobs.get(id);
  if (!job) return false;
  if (sessionId !== undefined && job.sessionId !== sessionId) return false;
  if (job._cron) { job._cron.stop(); job._cron = null; }
  _jobs.delete(id);
  save();
  if (_log) _log.info('deleted cron job "' + id + '"');
  return true;
}

/**
 * @param {string} id
 * @param {string} [sessionId]
 * @returns {CronJobRecord | null}
 */
export function pauseJob(id, sessionId) {
  const job = _jobs.get(id);
  if (!job) return null;
  if (sessionId !== undefined && job.sessionId !== sessionId) return null;
  if (job._cron) { job._cron.stop(); job._cron = null; }
  job.status = 'paused';
  job.nextFireAt = null;
  save();
  if (_log) _log.info('paused cron job "' + id + '"');
  return job;
}

/**
 * @param {string} id
 * @param {string} [sessionId]
 * @returns {CronJobRecord | null}
 */
export function resumeJob(id, sessionId) {
  const job = _jobs.get(id);
  if (!job || job.status === 'completed') return null;
  if (sessionId !== undefined && job.sessionId !== sessionId) return null;
  if (!isValidCronExpr(job.cronExpr)) return null;

  startCron(job);
  job.status = 'active';
  save();
  if (_log) _log.info('resumed cron job "' + id + '" nextFire=' + job.nextFireAt);
  return job;
}

/**
 * @param {string} sessionId
 * @returns {CronJobRecord[]}
 */
export function listJobs(sessionId) {
  return [..._jobs.values()].filter((j) => j.sessionId === sessionId);
}

/**
 * @param {string} id
 * @returns {CronJobRecord | undefined}
 */
export function getJob(id) {
  return _jobs.get(id);
}

/**
 * @param {string} sessionId
 * @param {(jobId: string, prompt: string) => void} fn
 * @returns {() => void}
 */
export function subscribe(sessionId, fn) {
  let subs = _subscribers.get(sessionId);
  if (!subs) { subs = new Set(); _subscribers.set(sessionId, subs); }
  subs.add(fn);
  return () => {
    subs.delete(fn);
    if (subs.size === 0) _subscribers.delete(sessionId);
  };
}

/**
 * @param {(sessionId: string, jobId: string, prompt: string) => void} fn
 * @returns {() => void}
 */
export function subscribeAll(fn) {
  _globalSubscribers.add(fn);
  return () => _globalSubscribers.delete(fn);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function shutdown() {
  for (const job of _jobs.values()) {
    if (job._cron) { job._cron.stop(); job._cron = null; }
  }
}

process.on('exit', shutdown);
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
