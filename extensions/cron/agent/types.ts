/**
 * extensions/cron/agent/types.ts — Cron plugin type definitions
 *
 * Core types for the cron scheduling system.
 * Module augmentation for SessionEntryExtension persists job snapshots
 * across session restarts without backend refetch.
 */

import type { PluginUiAdapter, SessionEntryExtension } from '@agent-type';

export { };

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Persisted cron jobs for this session (snapshot cache). */
    cronJobs?: CronJob[];
  }
}

// ── Core types ────────────────────────────────────────────────────────────────

export type CronStatus = 'active' | 'paused' | 'completed';

export interface CronJob {
  id: string;
  sessionId: string;
  label: string;
  cronExpr: string;
  prompt: string;
  recurring: boolean;
  status: CronStatus;
  createdAt: string;
  lastFiredAt: string | null;
  nextFireAt: string | null;
  completedAt: string | null;
  fireCount: number;
}

// ── Symbol state ──────────────────────────────────────────────────────────────

export interface CronSymbolState extends PluginUiAdapter {
  readonly type: 'cron';
  readonly jobs: readonly CronJob[];
}

// ── Adapter interface ─────────────────────────────────────────────────────────

export interface CronManagerAdapter {
  listJobs(opts: { sessionId: string }): Promise<CronJob[]>;
  createJob(opts: {
    sessionId: string;
    cronExpr: string;
    prompt: string;
    recurring?: boolean;
    label?: string;
  }): Promise<CronJob>;
  updateJob(
    id: string,
    sessionId: string,
    patch: { label?: string; cronExpr?: string; prompt?: string; recurring?: boolean },
  ): Promise<CronJob>;
  deleteJob(id: string, sessionId: string): Promise<void>;
  pauseJob(id: string, sessionId: string): Promise<CronJob>;
  resumeJob(id: string, sessionId: string): Promise<CronJob>;
  startListening(
    sessionId: string,
    onFired: (jobId: string, prompt: string) => void,
  ): () => void;
}
