// ── Module augmentation ───────────────────────────────────────────────────────
// This file must be a proper ES module (has `export {}`) so that `declare module`
// blocks are treated as augmentations, not ambient declarations.
export {};

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

// ── Adapter interface ─────────────────────────────────────────────────────────

/**
 * Dependency-injection contract for the cron panel UI and ToolSet.
 *
 * The default implementation (`createHttpCronAdapter`) talks to the Agent SDK
 * backend's `/api/cron` REST + SSE endpoints.
 */
export interface CronManagerAdapter {
  /** List all jobs for a session. */
  listJobs(opts: { sessionId: string }): Promise<CronJob[]>;

  /** Create a new cron job. */
  createJob(opts: {
    sessionId: string;
    cronExpr: string;
    prompt: string;
    recurring?: boolean;
    label?: string;
  }): Promise<CronJob>;

  /** Update mutable fields of an existing job. */
  updateJob(
    id: string,
    sessionId: string,
    patch: { label?: string; cronExpr?: string; prompt?: string; recurring?: boolean },
  ): Promise<CronJob>;

  /** Delete a job. */
  deleteJob(id: string, sessionId: string): Promise<void>;

  /** Pause an active job. */
  pauseJob(id: string, sessionId: string): Promise<CronJob>;

  /** Resume a paused job. */
  resumeJob(id: string, sessionId: string): Promise<CronJob>;

  /**
   * Start listening for fired-job events via SSE.
   * `onFired` is called each time the backend fires a job for this session.
   * Returns a cleanup function — call it when the session is removed.
   */
  startListening(
    sessionId: string,
    onFired: (jobId: string, prompt: string) => void,
  ): () => void;
}

// ── HTTP adapter config ───────────────────────────────────────────────────────

export interface HttpCronAdapterConfig {
  /** Base URL of the Agent SDK backend. Defaults to `'/api'`. */
  baseUrl?: string;
}

// ── Module augmentation ───────────────────────────────────────────────────────

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Persisted cron jobs for this session. */
    cronJobs?: CronJob[];
  }
}

declare module '@agent-type' {
  interface AgentSessionExtension {
    /** Live cron jobs exposed to the UI. */
    cronJobs?: readonly CronJob[];
    /** Pause a cron job from the UI panel. */
    cronPauseJob?: (id: string) => Promise<void>;
    /** Resume a cron job from the UI panel. */
    cronResumeJob?: (id: string) => Promise<void>;
    /** Delete a cron job from the UI panel. */
    cronDeleteJob?: (id: string) => Promise<void>;
  }
}
