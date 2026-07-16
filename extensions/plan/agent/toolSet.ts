// ── Side-effect: register module augmentation fields ─────────────────────────
import './types';

import { ctxKey } from '@agent-type';
import type { ToolSet, ToolSetContext, Tool, CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';
import type { SessionEntryData, PluginSlotDeclaration } from '@agent-type';
import { planStore } from './store';
import { createPlanTools } from './tools';
import { PLAN_GUIDANCE, PLAN_SECTION_ID } from './prompt';
import type { PlanSymbolState } from './types';

/**
 * Tools the agent may use while in plan mode.
 *
 * Plan mode is read-and-plan only: no writes, no execution.  The agent can
 * read the codebase for context, write/refine the plan, ask the user questions,
 * and exit plan mode when ready.  `tool_search` is included so the agent can
 * discover additional read-only tools if needed.
 */
const PLAN_MODE_ALLOWED = new Set([
  'plan_write',
  'plan_exit',
  'read_file',
  'list_dir',
  'search_files',
  'get_workspace_root',
  'ask_user',
  'tool_search',
]);

// ── Symbol ────────────────────────────────────────────────────────────────────

export const PLAN_SYMBOL = Symbol('plan');

// ── Compact tool-card descriptor helpers ──────────────────────────────────────

const TOOL_META: Record<string, { icon: string; label: string }> = {
  plan_write:      { icon: '📝', label: 'Plan' },
  plan_checkpoint: { icon: '⏸', label: 'Checkpoint' },
  plan_enter:      { icon: '🎯', label: 'Plan Mode' },
  plan_exit:       { icon: '✅', label: 'Exit Plan' },
  plan_verify:     { icon: '🔍', label: 'Verify' },
};

function planBadge(result: unknown): string {
  if (result && typeof result === 'object' && 'status' in result) {
    const s = String((result as Record<string, unknown>).status);
    if (s === 'approved') return '✓';
    if (s === 'rejected') return '✗';
    if (s === 'cancelled') return '⊘';
    if (s === 'changes_requested') return '↩';
    if (s === 'plan_mode_entered') return '⚡';
    if (s === 'no_plan') return '∅';
  }
  return '';
}

function planDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const meta = TOOL_META[info.name] ?? { icon: '📋', label: info.name };
  const badge = planBadge(info.result);
  return { icon: meta.icon, label: meta.label, summary: badge, status: info.status };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the plan ToolSet.
 *
 * Provides five tools — `plan_write`, `plan_checkpoint`, `plan_enter`,
 * `plan_exit`, and `plan_verify` — that let the agent maintain a live markdown
 * plan document per session, gate execution on human approval, and optionally
 * enter a restricted plan mode where only read and planning tools are visible.
 *
 * Requires `createUserInputToolSet` to be registered on the same agent so that
 * `context.requestUserInput` is available to `plan_checkpoint` and `plan_exit`.
 */
export function createPlanToolSet(): ToolSet {
  const tools = createPlanTools(planStore);

  function key(ctx: ToolSetContext): string {
    return ctxKey(ctx);
  }

  return {
    name: 'plan',
    symbol: PLAN_SYMBOL,
    sectionId: PLAN_SECTION_ID,
    sectionPriority: 60,
    tools,

    /**
     * All plan tools are core — the agent must always be able to see them so
     * it can initiate planning, checkpoint progress, and verify completion
     * without first having to discover them via `tool_search`.
     */
    coreTools: ['plan_write', 'plan_checkpoint', 'plan_enter', 'plan_exit', 'plan_verify'],

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      if (entryData?.plan) {
        planStore.set(key(ctx), entryData.plan);
      }
      if (entryData?.planMode) {
        planStore.setPlanMode(key(ctx), entryData.planMode);
      }
    },

    onReset(ctx: ToolSetContext): void {
      planStore.reset(key(ctx));
    },

    onRemove(ctx: ToolSetContext): void {
      planStore.remove(key(ctx));
    },

    /**
     * Symbol-isolated state: stored under `state[PLAN_SYMBOL]`.
     * The UI reads this via `getPluginState()[1]`.
     */
    onGetSymbolState(ctx: ToolSetContext) {
      const currentPlan = planStore.get(key(ctx));
      const inPlanMode = planStore.getPlanMode(key(ctx));

      return {
        type: 'plan',
        plan: currentPlan,
        planMode: inPlanMode,
        slots: [
          {
            type: 'panel' as const,
            label: 'Plan',
            showTab: () => true,
            shouldRender: () => !!currentPlan,
          },
          {
            type: 'toolCard' as const,
            toolNames: tools.map((t) => t.name),
          },
          {
            type: 'compactToolCard' as const,
            toolNames: tools.map((t) => t.name),
            getDescriptor: planDescriptor,
          },
        ] satisfies readonly PluginSlotDeclaration[],
      };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return planStore.subscribe(key(ctx), fn);
    },

    onBuildSnapshot(ctx: ToolSetContext) {
      const serialized = planStore.serialize(key(ctx));
      return serialized ? { plan: serialized.content, planMode: serialized.planMode } : {};
    },

    /**
     * In plan mode, restrict the visible tool set to `PLAN_MODE_ALLOWED`.
     * This enforces the "read and plan only — no execution" contract so the
     * agent physically cannot make changes to the codebase while planning.
     */
    onFilterTools(ctx: ToolSetContext, tools: readonly Tool[]): readonly Tool[] {
      if (!planStore.getPlanMode(key(ctx))) return tools;
      return tools.filter((t) => PLAN_MODE_ALLOWED.has(t.name));
    },

    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      const content = planStore.get(key(ctx));
      const inPlanMode = planStore.getPlanMode(key(ctx));

      if (inPlanMode) {
        const planBlock = content ?? 'No plan yet.';
        return `## Planning\n\n[Current Plan]\n${planBlock}\n\n### ⚠ Plan Mode Active\nYou are in plan mode. Design the approach and write the plan — do NOT execute any steps. Call plan_exit to submit for approval when ready.`;
      }

      if (!content) return PLAN_GUIDANCE;
      return `## Planning\n\n[Current Plan]\n${content}\n\nCall \`plan_checkpoint\` before executing steps on an unapproved plan.`;
    },
  };
}
