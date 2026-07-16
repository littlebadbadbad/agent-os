// ── Side-effect: register module augmentation fields ─────────────────────────
import './types';

import type { ToolSet, ToolSetContext, SessionReadyHelpers } from '@agent-type';
import type { SessionEntryData } from '@agent-type';
import type { CronManagerAdapter } from './types';
import { createCronTools } from './tools';
import { cronStore } from './store';

/** Minimum milliseconds between background job-list refreshes per session. */
const REFRESH_INTERVAL_MS = 60_000;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the cron ToolSet.
 *
 * Registers six tools (`cron_create`, `cron_update`, `cron_list`, `cron_delete`,
 * `cron_pause`, `cron_resume`) and wires the backend SSE stream so that
 * fired-job prompts are injected as user messages via `sendMessage`.
 *
 * @example
 * ```ts
 * const cronToolSet = createCronToolSet(
 *   createHttpCronAdapter({ baseUrl: '/api' }),
 * );
 * const agent = createAgentClient({ handler, toolSets: [cronToolSet] });
 * ```
 */
export function createCronToolSet(adapter: CronManagerAdapter): ToolSet {
  const tools = createCronTools(adapter);

  /** Timestamp of the last successful listJobs refresh, keyed by sessionId. */
  const lastRefreshAt = new Map<string, number>();

  /** Non-blocking background refresh — fires at most once per REFRESH_INTERVAL_MS. */
  function refreshJobs(sessionId: string): void {
    const now = Date.now();
    if ((now - (lastRefreshAt.get(sessionId) ?? 0)) < REFRESH_INTERVAL_MS) return;
    lastRefreshAt.set(sessionId, now);
    adapter.listJobs({ sessionId })
      .then((jobs) => cronStore.setJobs(sessionId, jobs))
      .catch(() => { /* stale data is acceptable — UI will show last known state */ });
  }

  return {
    name: 'cron',
    tools,

    // Expose cron_create and cron_list so they stay visible even when
    // createToolSearchToolSet defers low-priority tools behind tool_search.
    coreTools: ['cron_create', 'cron_list'],

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      // Restore snapshot so the UI can display jobs immediately on page load.
      // The real backend state is fetched in onSessionReady.
      if (entryData?.cronJobs?.length) {
        cronStore.setJobs(ctx.sessionId, entryData.cronJobs);
      }
    },

    onReady(ctx: ToolSetContext, helpers: SessionReadyHelpers): void {
      // Wire SSE so fired-job prompts become user messages.
      const stopFn = adapter.startListening(ctx.sessionId, (_jobId, prompt) => {
        helpers.sendMessage(prompt);
        // Refresh local job list after a fire so status / nextFireAt stay current.
        adapter.listJobs({ sessionId: ctx.sessionId })
          .then((jobs) => {
            cronStore.setJobs(ctx.sessionId, jobs);
            lastRefreshAt.set(ctx.sessionId, Date.now());
          })
          .catch(() => { /* best-effort */ });
      });
      cronStore.setStopListening(ctx.sessionId, stopFn);

      // Sync backend state right away — the persisted snapshot may be stale
      // (jobs may have fired, been deleted, or changed status since last save).
      adapter.listJobs({ sessionId: ctx.sessionId })
        .then((jobs) => {
          cronStore.setJobs(ctx.sessionId, jobs);
          lastRefreshAt.set(ctx.sessionId, Date.now());
        })
        .catch(() => { /* keep snapshot as fallback */ });
    },

    // onReset is intentionally absent: cron jobs are session-scoped
    // autonomous entities, not part of the conversation history.  When the
    // user clears chat the jobs should continue running and remain visible
    // in the Cron panel.  Only onRemove tears everything down.

    onRemove(ctx: ToolSetContext): void {
      cronStore.stopListening(ctx.sessionId);
      cronStore.remove(ctx.sessionId);
      lastRefreshAt.delete(ctx.sessionId);
    },

    onBeforeRun(ctx: ToolSetContext): void {
      // Best-effort non-blocking refresh before each run so the system prompt
      // reflects reasonably current nextFireAt values.
      refreshJobs(ctx.sessionId);
    },

    onGetState(ctx: ToolSetContext) {
      const sessionId = ctx.sessionId;
      return {
        cronJobs: cronStore.getJobs(sessionId),
        cronPauseJob: async (id: string) => {
          const job = await adapter.pauseJob(id, sessionId);
          cronStore.updateJob(sessionId, job);
        },
        cronResumeJob: async (id: string) => {
          const job = await adapter.resumeJob(id, sessionId);
          cronStore.updateJob(sessionId, job);
        },
        cronDeleteJob: async (id: string) => {
          await adapter.deleteJob(id, sessionId);
          cronStore.removeJob(sessionId, id);
        },
      };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return cronStore.subscribe(ctx.sessionId, fn);
    },

    onBuildSnapshot(ctx: ToolSetContext) {
      const jobs = cronStore.getJobs(ctx.sessionId);
      return jobs.length > 0 ? { cronJobs: jobs } : {};
    },

    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      const jobs = cronStore.getJobs(ctx.sessionId)
        .filter((j) => j.status === 'active' || j.status === 'paused');
      if (jobs.length === 0) return undefined;

      const lines = jobs.map((j) => {
        const next = j.status === 'active'
          ? `next: ${j.nextFireAt ?? 'unknown'}`
          : 'paused';
        return `  - [${j.status.toUpperCase()}] "${j.label}" (${j.cronExpr}) → ${next}`;
      }).join('\n');

      return (
        `## Scheduled Tasks\n\n` +
        `The following cron jobs exist for this session:\n${lines}\n\n` +
        `When a scheduled message arrives, treat it as a routine task trigger and execute the requested action. ` +
        `Use cron_list to get up-to-date status at any time.`
      );
    },
  };
}

