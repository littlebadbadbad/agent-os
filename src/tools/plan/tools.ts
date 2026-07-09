import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { ctxKey } from '@agent-sdk/tools/toolSet';
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
      'Pause for user review of the current plan before proceeding. ' +
      'Call plan_write first to ensure the latest plan is visible, then call this. ' +
      'Returns { status: "approved" } | { status: "rejected", feedback: string } | { status: "cancelled" }.',
    parameters: z.object({
      message: z
        .string()
        .min(1)
        .describe(
          'Brief context shown before the approval prompt, ' +
          'e.g. "Ready to implement the auth refactor �?please review the plan above."',
        ),
    }),
    execute: async ({ message }, context) => {
      const action = await context.requestUserInput?.({
        type: 'select',
        message,
        options: ['Approve', 'Request changes', 'Cancel'],
      });

      if (action === null || action === undefined || action === 'Cancel') {
        return { status: 'cancelled' as const };
      }

      if (action === 'Approve') {
        return { status: 'approved' as const };
      }

      // 'Request changes' �?collect feedback in a second prompt
      const feedback = await context.requestUserInput?.({
        type: 'text',
        message: 'Describe the changes needed:',
        placeholder: 'e.g. "Split step 3 into two steps, the scope is too broad"',
      });

      if (feedback === null || feedback === undefined) {
        return { status: 'cancelled' as const };
      }

      return { status: 'rejected' as const, feedback: feedback.trim() };
    },
  });

  // ── plan_enter ──────────────────────────────────────────────────────────────

  const planEnter = defineTool({
    name: 'plan_enter',
    group: 'Planning',
    description:
      'Enter plan mode. In plan mode you design and refine your approach before executing. ' +
      'Only write the plan �?do not make any changes to the codebase. ' +
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
      'The user will be asked to approve or request changes. ' +
      'Call this only after the plan is complete and ready for review.',
    parameters: z.object({}),
    execute: async (_, context) => {
      const key = ctxKey(context);
      const current = store.get(key);
      store.setPlanMode(key, false);

      if (!current) {
        return { status: 'no_plan', message: 'No plan found. Write a plan first with plan_write.' };
      }

      const action = await context.requestUserInput?.({
        type: 'select',
        message: 'Plan is ready for review. What would you like to do?',
        options: ['Approve and execute', 'Request changes', 'Cancel'],
      });

      if (action === null || action === undefined || action === 'Cancel') {
        return { status: 'cancelled' };
      }

      if (action === 'Approve and execute') {
        return {
          status: 'approved',
          message: 'Plan approved. Proceed to execute the plan step by step. Use todo_write to track progress.',
        };
      }

      // Request changes �?go back to plan mode
      const feedback = await context.requestUserInput?.({
        type: 'text',
        message: 'What changes are needed?',
        placeholder: 'Describe the adjustments...',
      });

      if (feedback === null || feedback === undefined) return { status: 'cancelled' };

      store.setPlanMode(key, true); // back to plan mode
      return { status: 'changes_requested', feedback: feedback.trim() };
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
        'Optional plan text to verify against. When omitted, the stored plan is used.',
      ),
    }),
    execute: async ({ plan }, context) => {
      const key = ctxKey(context);
      const stored = plan ?? store.get(key);

      if (!stored) {
        return { verified: false, message: 'No plan found to verify against.' };
      }

      return {
        verified: true,
        planPreview: stored.length > 2000 ? stored.slice(0, 2000) + `\n\n…[truncated, ${stored.length - 2000} more chars]` : stored,
        message: 'Review the plan above and check each item against the current state. ' +
          'Use todo_read to see task progress. Mark any remaining items as new tasks and complete them.',
      };
    },
  });

  return [planWrite, planCheckpoint, planEnter, planExit, planVerify] as const;
}
