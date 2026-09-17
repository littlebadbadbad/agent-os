import './types';
import { ctxKey } from '@agent-type';
import type { ToolSet, ToolSetContext, Tool, AgentRunOutcome, SlotDeclaration, ToolCallInfo, CompactToolCardDescriptor } from '@agent-type';
import type { SessionEntryData } from '@agent-type';
import { planStore } from './store';
import { createPlanTools } from './tools';
import { PLAN_GUIDANCE } from './prompt';

const PLAN_MODE_ALLOWED = new Set([
  'plan_write', 'plan_exit', 'read_file', 'list_dir',
  'search_files', 'get_workspace_root', 'ask_user', 'manage_tools',
]);

export const PLAN_SYMBOL = Symbol('plan');

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
    if (s === 'awaiting_input') return '⏳';
  }
  return '';
}

function planDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const meta = TOOL_META[info.name] ?? { icon: '📋', label: info.name };
  const badge = planBadge(info.result);
  return { icon: meta.icon, label: meta.label, summary: badge, status: info.status };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPlanToolSet(): ToolSet {
  const tools = createPlanTools(planStore);

  function key(ctx: ToolSetContext): string {
    return ctxKey(ctx);
  }

  return {
    name: 'plan',
    symbol: PLAN_SYMBOL,
    tools,

    onInit(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      if (entryData?.plan) {
        planStore.set(key(ctx), entryData.plan);
      }
      if (entryData?.planMode) {
        planStore.setPlanMode(key(ctx), entryData.planMode);
      }
      if (entryData?.planPendingApproval) {
        planStore.setPendingApproval(key(ctx), entryData.planPendingApproval);
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
     * The UI reads this via `getAppState()[1]`.
     */
    onGetSymbolState(ctx: ToolSetContext) {
      const currentPlan = planStore.get(key(ctx));
      const inPlanMode = planStore.getPlanMode(key(ctx));
      return {
        type: 'plan',
        plan: currentPlan,
        planMode: inPlanMode,
        pendingApproval: planStore.getPendingApproval(key(ctx)),
      };
    },

    onSubscribe(ctx: ToolSetContext, fn: () => void): () => void {
      return planStore.subscribe(key(ctx), fn);
    },

    onBuildSnapshot(ctx: ToolSetContext) {
      const serialized = planStore.serialize(key(ctx));
      if (!serialized) return {};
      return {
        plan: serialized.content,
        planMode: serialized.planMode,
        ...(serialized.pendingApproval ? { planPendingApproval: serialized.pendingApproval } : {}),
      };
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

    /**
     * After a successful agent run, clear any pending approval that was
     * consumed — it was already shown in the system prompt for that turn.
     */
    onAfterRun(ctx: ToolSetContext, _outcome: AgentRunOutcome): void {
      if (planStore.getPendingApproval(key(ctx))) {
        planStore.setPendingApproval(key(ctx), null);
      }
    },

    onGetSystemPrompt(ctx: ToolSetContext): string | undefined {
      const content = planStore.get(key(ctx));
      const inPlanMode = planStore.getPlanMode(key(ctx));
      const pendingApproval = planStore.getPendingApproval(key(ctx));

      // ── Pending approval: user was asked for input ─────────────────────
      if (pendingApproval) {
        const stage = pendingApproval.stage === 'checkpoint' ? 'checkpoint review' : 'plan exit review';
        return [
          `## Planning (awaiting user response — ${stage})`,
          '',
          `You previously asked the user: "${pendingApproval.message}"`,
          '',
          'The user has now responded. Read their message and react accordingly:',
          '- **Approve / Approve and execute**: proceed with the plan.',
          '- **Request changes**: gather feedback and update the plan.',
          '- **Cancel**: stop the current workflow.',
          '',
          'Do NOT call plan_checkpoint or plan_exit again — the user already answered.',
        ].join('\n');
      }

      if (inPlanMode) {
        const planBlock = content ?? 'No plan yet.';
        return `## Planning\n\n[Current Plan]\n${planBlock}\n\n### ⚠ Plan Mode Active\nYou are in plan mode. Design the approach and write the plan — do NOT execute any steps. Call plan_exit to submit for approval when ready.`;
      }

      if (!content) return PLAN_GUIDANCE;
      return `## Planning\n\n[Current Plan]\n${content}\n\nCall \`plan_checkpoint\` before executing steps on an unapproved plan.`;
    },
  };
}

export function getPlanSlotDeclarations(
  toolNames: readonly string[],
): readonly SlotDeclaration[] {
  return [
    {
      type: 'panel' as const,
      label: 'Plan',
      showTab: () => true,
      shouldRender: (_ctx, state) => !!state?.plan,
    },
    {
      type: 'toolCard' as const,
      toolNames,
    },
    {
      type: 'compactToolCard' as const,
      toolNames,
      getDescriptor: planDescriptor,
    },
  ] satisfies readonly SlotDeclaration[];
}
