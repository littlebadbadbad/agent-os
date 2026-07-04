/**
 * Cron manager — job registry backed by croner for reliable, event-driven scheduling.
 *
 * Persistence:  jobs are written to data/cron-jobs.json on every mutation via
 *               an atomic write (tmp → rename).  On startup all previously-active
 *               jobs are automatically resumed; completed jobs older than
 *               COMPLETED_TTL_MS are pruned.
 *
 * Security:     pause / resume / delete / update all require the caller to supply
 *               the owning sessionId — mismatched operations return null / false.
 *
 * Public API:
 *   createJob   pauseJob    listJobs   subscribe    serializeJob
 *   deleteJob   resumeJob   getJob     updateJob    subscribeAll
 */

import { Cron } from 'croner';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { cronToHuman } from './human.js';
import { createLogger } from '../logger.js';
import { DATA_ROOT } from '../paths.js';

const log = createLogger('cron-manager');

/** Maximum non-completed jobs allowed per session. */
const MAX_JOBS = 50;

/** Completed jobs are pruned after this many milliseconds (24 h). */
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;

const PERSIST_FILE = join(DATA_ROOT, 'cron-jobs.json');
const PERSIST_TMP  = `${PERSIST_FILE}.tmp`;

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Registry ──────────────────────────────────────────────────────────────────

/** @type {Map<string, CronJobRecord>} */
const _jobs = new Map();

/** @type {Map<string, Set<(jobId: string, prompt: string) => void>>} */
const _subscribers = new Map();

/** IDs of jobs currently inside their fire callback — prevents double-fire on overlap. */
const _inFlight = new Set();

/** Global subscribers — receive every fired event regardless of session. */
const _globalSubscribers = new Set();

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Return a plain-object representation of a job suitable for JSON responses
 * and file persistence.  Strips the internal `_cron` scheduler instance.
 *
 * @param {CronJobRecord} job
 * @returns {Omit<CronJobRecord, '_cron'>}
 */
export function serializeJob(job) {
  const { _cron: _, ...rest } = job;
  return rest;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function save() {
  try {
    const data = JSON.stringify([..._jobs.values()].map(serializeJob), null, 2);
    writeFileSync(PERSIST_TMP, data, 'utf8');
    renameSync(PERSIST_TMP, PERSIST_FILE);
  } catch (err) {
    log.error('failed to persist cron jobs', err.message);
  }
}

function load() {
  if (!existsSync(PERSIST_FILE)) return;
  try {
    const raw = readFileSync(PERSIST_FILE, 'utf8');
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
          log.warn(`could not resume job "${job.id}" after reload: ${err.message}`);
          job.status = 'paused';
        }
      }
    }
    log.info(`loaded ${entries.length} cron job(s) from disk`);
    pruneCompleted();
  } catch (err) {
    log.error('failed to load cron-jobs.json', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return true when the expression is a valid 5-field cron pattern.
 *
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
 * Create (or recreate) the Cron instance for a job and start it.
 * Stops any existing Cron on the job first, making it safe to call on resume.
 *
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
        log.info(`cron fired: ${job.id} (${job.label})`);
        job.lastFiredAt = new Date().toISOString();
        job.fireCount += 1;

        const subs = _subscribers.get(job.sessionId);
        if (subs) {
          for (const fn of subs) {
            try { fn(job.id, job.prompt); } catch { /* subscriber error — swallowed */ }
          }
        }

        for (const fn of _globalSubscribers) {
          try { fn(job.sessionId, job.id, job.prompt); } catch { /* swallowed */ }
        }

        // nextRun() returns null once maxRuns is exhausted (one-shot after firing).
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

/**
 * Remove completed jobs whose completedAt is older than COMPLETED_TTL_MS.
 * Called on startup after loading persisted jobs.
 */
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
    log.info(`pruned ${pruned} expired completed cron job(s)`);
    save();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create and immediately schedule a new cron job.
 *
 * @param {{ sessionId: string, cronExpr: string, prompt: string, recurring?: boolean, label?: string }} opts
 * @returns {CronJobRecord}
 */
export function createJob({ sessionId, cronExpr, prompt, recurring = true, label }) {
  if (!isValidCronExpr(cronExpr)) {
    throw new Error(`Invalid cron expression: "${cronExpr}"`);
  }

  const activeCount = [..._jobs.values()].filter(
    j => j.sessionId === sessionId && j.status !== 'completed',
  ).length;
  if (activeCount >= MAX_JOBS) {
    throw new Error(`Session has reached the maximum of ${MAX_JOBS} active cron jobs`);
  }

  const id = `cron_${randomBytes(4).toString('hex')}`;

  /** @type {CronJobRecord} */
  const job = {
    id,
    sessionId,
    label: label ?? cronToHuman(cronExpr),
    cronExpr,
    prompt,
    recurring,
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
  log.ok(`created cron job "${id}" (${job.label}) nextFire=${job.nextFireAt}`);
  return job;
}

/**
 * Update a job's mutable fields (label, cronExpr, prompt, recurring).
 * When cronExpr or recurring changes the job is rescheduled from now.
 *
 * @param {string} id
 * @param {string} sessionId  Must match the job's owning session.
 * @param {{ label?: string, cronExpr?: string, prompt?: string, recurring?: boolean }} patch
 * @returns {CronJobRecord | null}  null when not found, wrong session, or already completed.
 */
export function updateJob(id, sessionId, patch) {
  const job = _jobs.get(id);
  if (!job) return null;
  if (job.sessionId !== sessionId) return null;
  if (job.status === 'completed') return null;

  const needsReschedule =
    (patch.cronExpr  !== undefined && patch.cronExpr  !== job.cronExpr) ||
    (patch.recurring !== undefined && patch.recurring !== job.recurring);

  if (patch.cronExpr !== undefined) {
    if (!isValidCronExpr(patch.cronExpr)) {
      throw new Error(`Invalid cron expression: "${patch.cronExpr}"`);
    }
    job.cronExpr = patch.cronExpr;
    // Auto-regenerate label only when the caller didn't supply an explicit one.
    if (patch.label === undefined) job.label = cronToHuman(patch.cronExpr);
  }
  if (patch.label     !== undefined) job.label    = patch.label;
  if (patch.prompt    !== undefined) job.prompt    = patch.prompt;
  if (patch.recurring !== undefined) job.recurring = patch.recurring;

  if (needsReschedule && job.status === 'active') {
    startCron(job);
  }

  save();
  log.info(`updated cron job "${id}"`);
  return job;
}

/**
 * Stop and remove a cron job.
 *
 * @param {string} id
 * @param {string} [sessionId]  When provided, ownership is verified.
 * @returns {boolean}
 */
export function deleteJob(id, sessionId) {
  const job = _jobs.get(id);
  if (!job) return false;
  if (sessionId !== undefined && job.sessionId !== sessionId) return false;
  job._cron?.stop();
  job._cron = null;
  _jobs.delete(id);
  save();
  log.info(`deleted cron job "${id}"`);
  return true;
}

/**
 * Pause a running job — stops its Cron instance and clears nextFireAt.
 *
 * @param {string} id
 * @param {string} [sessionId]  When provided, ownership is verified.
 * @returns {CronJobRecord | null}
 */
export function pauseJob(id, sessionId) {
  const job = _jobs.get(id);
  if (!job) return null;
  if (sessionId !== undefined && job.sessionId !== sessionId) return null;
  job._cron?.stop();
  job._cron = null;
  job.status = 'paused';
  job.nextFireAt = null;
  save();
  log.info(`paused cron job "${id}"`);
  return job;
}

/**
 * Resume a paused job — creates a fresh Cron instance from the current time.
 * Also works on active jobs (re-schedules from now).
 * Returns null if the job doesn't exist, is completed, has a wrong session, or
 * has an invalid cronExpr.
 *
 * @param {string} id
 * @param {string} [sessionId]  When provided, ownership is verified.
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
  log.info(`resumed cron job "${id}" nextFire=${job.nextFireAt}`);
  return job;
}

/**
 * List all jobs for a session.
 *
 * @param {string} sessionId
 * @returns {CronJobRecord[]}
 */
export function listJobs(sessionId) {
  return [..._jobs.values()].filter(j => j.sessionId === sessionId);
}

/**
 * Get a single job by id.
 *
 * @param {string} id
 * @returns {CronJobRecord | undefined}
 */
export function getJob(id) {
  return _jobs.get(id);
}

/**
 * Subscribe to job-fired events for a session (SSE bridge).
 * Returns an unsubscribe function.
 *
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
 * Subscribe to ALL fired events across every session.
 * The callback receives (sessionId, jobId, prompt).
 * Returns an unsubscribe function.
 *
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
    job._cron?.stop();
    job._cron = null;
  }
}

process.on('exit',   shutdown);
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
process.on('SIGINT',  () => { shutdown(); process.exit(0); });

// ── Startup ───────────────────────────────────────────────────────────────────

load();

