import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { ctxKey } from '@agent-type';
import type { planStore as PlanStore } from './store';

// ── Tools ─────────────────────────────────────────────────────────────────────

export function createPlanTools(store: typeof PlanStore) {
  // ── plan_write ──────────────────────────────────────────────────────────────

  const planWrite = defineTool({
    name: 'plan_write',
    group: 'Planning',
    description: 'Write or update the plan as a full markdown document. Always submit the complete document.',
    parameters: z.object({
      content: z.string().min(1).describe('Full plan as a markdown string.'),
    }),
    execute: async ({ content }, context) => {
      const key = ctxKey(context);
      store.set(key, content);
      return { success: true };
    },
  });

  // ── plan_checkpoint ─────────────────────────────────────────────────────────

  const planCheckpoint = defineTool({
    name: 'plan_checkpoint',
    group: 'Planning',
    description:
      'Ask the user to review the current plan. The question is sent detached — ' +
      'the tool returns immediately and the answer arrives as a user message. ' +
      'Call plan_write first. Returns { status: "awaiting_input" }.',
    parameters: z.object({
      message: z.string().min(1).describe(
        'Brief context shown before the approval prompt, ' +
        'e.g. "Ready to implement the auth refactor — please review the plan above."',
      ),
    }),
    execute: async ({ message }, context) => {
      const key = ctxKey(context);
      void context.requestUserInput?.({ type: 'select', message, options: ['Approve', 'Request changes', 'Cancel'], mode: 'detached' });
      store.setPendingApproval(key, { stage: 'checkpoint', message });
      return { status: 'awaiting_input', message: 'Awaiting user approval for the current plan.' };
    },
  });

  // ── plan_enter ──────────────────────────────────────────────────────────────

  const planEnter = defineTool({
    name: 'plan_enter',
    group: 'Planning',
    description:
      'Enter plan mode. In plan mode you design and refine your approach before executing. ' +
      'Only write the plan — do not make any changes to the codebase. ' +
      'Use plan_write to capture the plan, then call plan_exit when ready to submit for approval.',
    parameters: z.object({}),
    execute: async (_, context) => {
      const key = ctxKey(context);
      store.setPlanMode(key, true);
      return { status: 'plan_mode_entered', message: 'You are now in plan mode. Design your approach and write the plan with plan_write.' };
    },
  });

  // ── plan_exit ───────────────────────────────────────────────────────────────

  const planExit = defineTool({
    name: 'plan_exit',
    group: 'Planning',
    description:
      'Exit plan mode and submit the current plan for user approval. ' +
      'The question is sent detached. ' +
      'Returns { status: "awaiting_input" }.',
    parameters: z.object({}),
    execute: async (_, context) => {
      const key = ctxKey(context);
      const current = store.get(key);
      store.setPlanMode(key, false);
      if (!current) return { status: 'no_plan', message: 'No plan found. Write a plan first with plan_write.' };

      void context.requestUserInput?.({ type: 'select', message: 'Plan is ready for review. What would you like to do?', options: ['Approve and execute', 'Request changes', 'Cancel'], mode: 'detached' });
      store.setPendingApproval(key, { stage: 'exit', message: 'Plan is ready for review. What would you like to do?' });
      return { status: 'awaiting_input', message: 'Awaiting user approval for the plan.' };
    },
  });

  // ── plan_verify ─────────────────────────────────────────────────────────────

  const planVerify = defineTool({
    name: 'plan_verify',
    group: 'Planning',
    description:
      'Verify that the plan has been fully executed. ' +
      'Compare the current state against the plan items. ' +
      'Returns a list of completed and pending items.',
    parameters: z.object({
      plan: z.string().optional().describe(
        'The plan text to verify against. If omitted, the current plan will be used.',
      ),
      completed: z.array(z.string()).optional().describe(
        'List of step descriptions that have been completed to prevent misreporting.',
      ),
    }),
    execute: async ({ plan: planText, completed }, context) => {
      const key = ctxKey(context);
      const actualPlan = planText || store.get(key) || '';

      const stepPattern = /^\d+[\.\)]\s+(.+)$/gm;
      const steps: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = stepPattern.exec(actualPlan)) !== null) {
        steps.push(match[1].trim());
      }

      const completedSet = new Set((completed || []).map((s) => s.trim().toLowerCase()));

      const stepStatuses = steps.map((step) => ({
        description: step,
        done: completedSet.has(step.trim().toLowerCase()),
      }));

      return {
        total: steps.length,
        completed: stepStatuses.filter((s) => s.done).length,
        pending: stepStatuses.filter((s) => !s.done).length,
        steps: stepStatuses,
      };
    },
  });

  return [planWrite, planCheckpoint, planEnter, planExit, planVerify];
}
