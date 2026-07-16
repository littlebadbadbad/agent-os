/**
 * extensions/cron/agent/tools.ts — Cron tool definitions
 *
 * Six tools for scheduling management:
 *   cron_create, cron_update, cron_list, cron_delete, cron_pause, cron_resume
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { CronManagerAdapter } from './types';
import { cronStore } from './store';

// ── Tool factory ──────────────────────────────────────────────────────────────

export function createCronTools(adapter: CronManagerAdapter) {
  const cronCreate = defineTool({
    name: 'cron_create',
    group: 'Scheduling',
    description:
      'Schedule a recurring or one-shot task using a cron expression. ' +
      'When the job fires, the given prompt is injected as a new user message, ' +
      'driving the next agent turn automatically. ' +
      'Use standard 5-field cron syntax: minute hour day-of-month month day-of-week. ' +
      'Examples: "*/5 * * * *" (every 5 min), "0 9 * * 1" (every Monday at 09:00).',
    parameters: z.object({
      cronExpr: z
        .string()
        .describe('5-field cron expression, e.g. "0 */6 * * *" for every 6 hours.'),
      prompt: z
        .string()
        .describe('Message to inject as a user turn when the job fires.'),
      recurring: z
        .boolean()
        .optional()
        .default(true)
        .describe('true = repeat on schedule; false = fire once then complete. Defaults to true.'),
      label: z
        .string()
        .optional()
        .describe('Human-readable label. Defaults to a description derived from the cron expression.'),
    }),
    execute: async ({ cronExpr, prompt, recurring, label }, ctx) => {
      if (ctx.isSubAgent) {
        return { error: 'Cron jobs can only be managed from the main conversation.' };
      }
      const job = await adapter.createJob({
        sessionId: ctx.sessionId,
        cronExpr,
        prompt,
        recurring,
        label,
      });
      cronStore.updateJob(ctx.sessionId, job);
      return {
        id: job.id,
        label: job.label,
        cronExpr: job.cronExpr,
        status: job.status,
        recurring: job.recurring,
        nextFireAt: job.nextFireAt,
      };
    },
  });

  const cronList = defineTool({
    name: 'cron_list',
    group: 'Scheduling',
    description: 'List all scheduled cron jobs for the current session, including their status and next fire time.',
    parameters: z.object({}),
    execute: async (_args, ctx) => {
      if (ctx.isSubAgent) {
        return { jobs: [], message: 'Cron jobs are not available in sub-agent conversations.' };
      }
      const jobs = await adapter.listJobs({ sessionId: ctx.sessionId });
      cronStore.setJobs(ctx.sessionId, jobs);
      if (jobs.length === 0) return { jobs: [], message: 'No cron jobs scheduled.' };
      return {
        jobs: jobs.map((j) => ({
          id: j.id,
          label: j.label,
          cronExpr: j.cronExpr,
          status: j.status,
          recurring: j.recurring,
          nextFireAt: j.nextFireAt,
          fireCount: j.fireCount,
          lastFiredAt: j.lastFiredAt,
        })),
      };
    },
  });

  const cronDelete = defineTool({
    name: 'cron_delete',
    group: 'Scheduling',
    description: 'Permanently delete a cron job by its ID. Stopped immediately.',
    parameters: z.object({
      id: z.string().describe('The cron job ID to delete.'),
    }),
    execute: async ({ id }, ctx) => {
      if (ctx.isSubAgent) {
        return { error: 'Cron jobs can only be managed from the main conversation.', id };
      }
      await adapter.deleteJob(id, ctx.sessionId);
      cronStore.removeJob(ctx.sessionId, id);
      return { success: true, id };
    },
  });

  const cronPause = defineTool({
    name: 'cron_pause',
    group: 'Scheduling',
    description: 'Pause an active cron job. The job remains in the list but will not fire until resumed.',
    parameters: z.object({
      id: z.string().describe('The cron job ID to pause.'),
    }),
    execute: async ({ id }, ctx) => {
      if (ctx.isSubAgent) {
        return { error: 'Cron jobs can only be managed from the main conversation.', id };
      }
      const job = await adapter.pauseJob(id, ctx.sessionId);
      cronStore.updateJob(ctx.sessionId, job);
      return { id: job.id, status: job.status, label: job.label };
    },
  });

  const cronResume = defineTool({
    name: 'cron_resume',
    group: 'Scheduling',
    description: 'Resume a paused cron job. The next fire time is recalculated from now.',
    parameters: z.object({
      id: z.string().describe('The cron job ID to resume.'),
    }),
    execute: async ({ id }, ctx) => {
      if (ctx.isSubAgent) {
        return { error: 'Cron jobs can only be managed from the main conversation.', id };
      }
      const job = await adapter.resumeJob(id, ctx.sessionId);
      cronStore.updateJob(ctx.sessionId, job);
      return { id: job.id, status: job.status, nextFireAt: job.nextFireAt, label: job.label };
    },
  });

  const cronUpdate = defineTool({
    name: 'cron_update',
    group: 'Scheduling',
    description:
      'Update mutable fields of an existing cron job without deleting and recreating it. ' +
      'All fields are optional — only supplied fields are changed.',
    parameters: z.object({
      id: z.string().describe('The cron job ID to update.'),
      cronExpr: z
        .string()
        .optional()
        .describe('New 5-field cron expression. Rescheduling takes effect immediately.'),
      prompt: z
        .string()
        .optional()
        .describe('New prompt to inject when the job fires.'),
      label: z
        .string()
        .optional()
        .describe('New human-readable label.'),
      recurring: z
        .boolean()
        .optional()
        .describe('Change between recurring and one-shot.'),
    }),
    execute: async ({ id, cronExpr, prompt, label, recurring }, ctx) => {
      if (ctx.isSubAgent) {
        return { error: 'Cron jobs can only be managed from the main conversation.', id };
      }
      const job = await adapter.updateJob(id, ctx.sessionId, { cronExpr, prompt, label, recurring });
      cronStore.updateJob(ctx.sessionId, job);
      return {
        id: job.id,
        label: job.label,
        cronExpr: job.cronExpr,
        status: job.status,
        recurring: job.recurring,
        nextFireAt: job.nextFireAt,
      };
    },
  });

  return [cronCreate, cronUpdate, cronList, cronDelete, cronPause, cronResume];
}
