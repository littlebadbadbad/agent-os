/**
 * extensions/cron/agent/toolSet.ts — Cron scheduling ToolSet
 *
 * Registers six tools (cron_create, cron_update, cron_list, cron_delete,
 * cron_pause, cron_resume) and wires the backend stream so that fired-job
 * prompts are injected as user messages via sendMessage.
 *
 * Uses onGetSymbolState (not onGetState) to expose state to the plugin
 * iframe panel through the symbol-isolated state slice.
 *
 * ## Scope restriction
 *
 * ALL lifecycle hooks and the symbol state delegate to
 * `isMainConversation(ctx)` so cron only binds data and displays slots
 * for the **main-agent conversation** (`MAIN_CONVERSATION_ID`).
 * Sub-agent conversations never see cron jobs, system-prompt sections,
 * or panel tabs — they are not allowed to manage schedules.
 */

import type { ToolSet, ToolSetContext, SessionReadyHelpers, SessionEntryData } from '@agent-type';
import { ctxKey, MAIN_CONVERSATION_ID } from '@agent-type';
import type { CronManagerAdapter, CronSymbolState } from './types';
import { createCronTools } from './tools';
import { cronStore } from './store';

// ── Symbol ────────────────────────────────────────────────────────────────────

export const CRON_SYMBOL = Symbol('cron');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum milliseconds between background job-list refreshes per session. */
const REFRESH_INTERVAL_MS = 60_000;

// ── Scope guard ──────────────────────────────────────────────────────────────

/** `true` when the context is the main-agent conversation (not a sub-agent). */
function isMainConversation(ctx: ToolSetContext): boolean {
  return ctx.conversationId === MAIN_CONVERSATION_ID;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCronToolSet(adapter: CronManagerAdapter): ToolSet {
  const tools = createCronTools(adapter);

  const lastRefreshAt = new Map<string, number>();

  function refreshJobs(sessionId: string): void {
    const now = Date.now();
    if ((now - (lastRefreshAt.get(sessionId) ?? 0)) < REFRESH_INTERVAL_MS) return;
    lastRefreshAt.set(sessionId, now);
    adapter.listJobs({ sessionId })
      .then((jobs) => cronStore.setJobs(sessionId, jobs))
      .catch(() => { /* stale data is acceptable */ });
  }

  return {
    symbol: CRON_SYMBOL,
    name: 'cron',
    description: 'Scheduled task management via cron expressions.',
    tools,
    coreTools: ['cron_create', 'cron_list'],

    // ── System prompt ──────────────────────────────────────────────────────

    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      if (!isMainConversation(ctx)) return undefined;

      const jobs = cronStore.getJobs(ctxKey(ctx))
        .filter((j) => j.status === 'active' || j.status === 'paused');
      if (jobs.length === 0) return undefined;

      const lines = jobs.map((j) => {
        const next = j.status === 'active'
          ? `next: ${j.nextFireAt ?? 'unknown'}`
          : 'paused';
        return `  - [${j.status.toUpperCase()}] "${j.label}" (${j.cronExpr}) -> ${next}`;
      }).join('\n');

      return [
        '## Scheduled Tasks',
        '',
        `The following cron jobs exist for this session:`,
        lines,
        '',
        'When a scheduled message arrives, treat it as a routine task trigger ' +
        'and execute the requested action. Use cron_list for up-to-date status.',
      ].join('\n');
    },

    // ── Lifecycle ──────────────────────────────────────────────────────────

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      if (!isMainConversation(ctx)) return;

      const sessionId = ctxKey(ctx);
      const saved = entryData?.cronJobs;
      if (saved?.length) {
        cronStore.setJobs(sessionId, saved);
      }
    },

    onReady(ctx: ToolSetContext, helpers: SessionReadyHelpers): void {
      if (!isMainConversation(ctx)) return;

      const sessionId = ctxKey(ctx);

      // Wire stream so fired-job prompts become user messages.
      const stopFn = adapter.startListening(sessionId, (_jobId, prompt) => {
        helpers.sendMessage(prompt);
        adapter.listJobs({ sessionId })
          .then((jobs) => {
            cronStore.setJobs(sessionId, jobs);
            lastRefreshAt.set(sessionId, Date.now());
          })
          .catch(() => { /* best-effort */ });
      });
      cronStore.setStopListening(sessionId, stopFn);

      // Sync backend state right away — persisted snapshot may be stale.
      adapter.listJobs({ sessionId })
        .then((jobs) => {
          cronStore.setJobs(sessionId, jobs);
          lastRefreshAt.set(sessionId, Date.now());
        })
        .catch(() => { /* keep snapshot as fallback */ });
    },

    onRemove(ctx: ToolSetContext): void {
      if (!isMainConversation(ctx)) return;

      const sessionId = ctxKey(ctx);
      cronStore.stopListening(sessionId);
      cronStore.remove(sessionId);
      lastRefreshAt.delete(sessionId);
    },

    onReset(_ctx: ToolSetContext): void {
      // Cron jobs are session-scoped autonomous entities — do NOT clear
      // them on reset. Only onRemove tears everything down.
    },

    onBeforeRun(ctx: ToolSetContext): void {
      if (!isMainConversation(ctx)) return;
      refreshJobs(ctxKey(ctx));
    },

    // ── Symbol state (for plugin iframe panel) ─────────────────────────────

    onGetSymbolState(ctx: ToolSetContext): CronSymbolState {
      const sessionId = ctxKey(ctx);
      const jobs = isMainConversation(ctx) ? cronStore.getJobs(sessionId) : [];

      return {
        type: 'cron',
        jobs,
        slots: isMainConversation(ctx)
          ? [
              {
                type: 'panel',
                label: 'Cron',
                showTab: (sc) => cronStore.getJobs(sc.sessionId).length > 0,
                order: 30,
              },
            ]
          : [],
      };
    },

    // ── Subscription (for UI reactivity) ───────────────────────────────────

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return cronStore.subscribe(ctxKey(ctx), fn);
    },

    // ── Persistence ────────────────────────────────────────────────────────

    onBuildSnapshot(ctx: ToolSetContext) {
      if (!isMainConversation(ctx)) return {};
      const jobs = cronStore.getJobs(ctxKey(ctx));
      return jobs.length > 0 ? { cronJobs: jobs } : {};
    },
  };
}
