/**
 * Shared runtime utilities for the main-agent and sub-agent execution paths.
 *
 * These three pure functions encode the identical logic that was previously
 * duplicated between `handlerContext.ts` (main agent) and
 * `subagent/registry.ts` (sub-agents). Both callers now delegate here.
 *
 * All functions are stateless and side-effect-free — safe to import from
 * any layer.
 */

import type { Tool, AgentMessage, TokenUsage, AgentHandler, ToolSet, ToolSetContext, SystemPromptContext, CompactionNotice } from '@agent-type';
import type { Attachment, AgentRunOutcome } from '@agent-type';
import { isBranded } from './toolSet';
import type { HistoryTracker } from './historyTracker';

// ── ToolSet dispatch helpers ──────────────────────────────────────────────────
// Iterate ToolSet hook dispatch — identical in main-agent (sessionFactory.ts)
// and sub-agent (registryExecution.ts). Extract once to prevent drift.

/**
 * Dispatch `onInterceptMessage` across all ToolSets.
 * Returns `true` if any ToolSet intercepted the message, stopping the chain.
 */
export function dispatchOnInterceptMessage(
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
  text: string,
  attachments: readonly Attachment[] | undefined,
  isLoading: boolean,
): boolean {
  for (const ts of toolSets) {
    const r = ts.onInterceptMessage?.(ctx, { content: text, attachments }, isLoading);
    if (r?.intercepted) return true;
  }
  return false;
}

/** Dispatch `onBeforeRun` across all ToolSets. */
export function dispatchOnBeforeRun(
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
  history: readonly AgentMessage[],
): void {
  for (const ts of toolSets) ts.onBeforeRun?.(ctx, history);
}

/** Dispatch `onAfterRun` across all ToolSets. */
export function dispatchOnAfterRun(
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
  outcome: AgentRunOutcome,
): void {
  for (const ts of toolSets) ts.onAfterRun?.(ctx, outcome);
}

/** Collect injected messages from all ToolSets' `onBeforeInvoke`. */
export function dispatchOnBeforeInvoke(
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
): AgentMessage[] {
  return toolSets.flatMap((ts) => ts.onBeforeInvoke?.(ctx) ?? []);
}

// ── onBeforeInvoke wrapper ────────────────────────────────────────────────────

export function wrapOnBeforeInvoke(
  rawOnBeforeInvoke: () => AgentMessage[],
  tracker: HistoryTracker,
  onInjected?: (injected: readonly AgentMessage[]) => void,
): () => AgentMessage[] {
  return () => {
    const injected = rawOnBeforeInvoke();
    if (injected.length > 0) {
      tracker.injectToFull(injected);
      onInjected?.(injected);
    }
    return injected;
  };
}

// ── System-prompt assembly ────────────────────────────────────────────────────

/**
 * Fold all ToolSet `onGetSystemPrompt` hooks into a joined prompt string.
 *
 * ToolSets are iterated in registration order.  Each ToolSet receives a
 * `SystemPromptContext` with the accumulated prompt parts so far, enabling
 * conditional injection and cross-ToolSet awareness.
 *
 * Internally-branded ToolSets (built-in apps) may call
 * `suppressToolSetPrompt` to exclude another ToolSet's fragment from the
 * final prompt.  The suppressed ToolSet's `onGetSystemPrompt` still executes
 * so it can perform internal bookkeeping.
 *
 * @param base        Optional base system prompt (injected first).
 * @param toolSets    ToolSets whose `onGetSystemPrompt` to invoke.
 * @param ctx         Stable session/agent context for this turn.
 * @param userMessage The raw user message text, or `undefined` for
 *                    programmatic calls.
 * @param brand       Optional internal brand symbol for authorising
 *                    `suppressToolSetPrompt` calls.
 * @returns The joined prompt, or `undefined` when nothing was injected.
 */
export function buildSystemPrompt(
  base: string | undefined,
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
  userMessage?: string,
  brand?: symbol,
): string | undefined {
  const parts: string[] = [];
  if (base) parts.push(base);

  const suppressed = new Set<string>();
  const collected: Array<{ name: string; fragment: string | undefined }> = [];

  for (const ts of toolSets) {
    const promptCtx: SystemPromptContext = {
      userMessage,
      baseSystemPrompt: base,
      currentSystemPromptParts: [...parts],
      suppressToolSetPrompt: brand && isBranded(ts, brand)
        ? (name: string) => { suppressed.add(name); }
        : () => { /* no-op: only branded ToolSets can suppress */ },
    };

    const fragment = ts.onGetSystemPrompt?.(ctx, promptCtx, toolSets);
    collected.push({ name: ts.name, fragment });
    if (fragment) parts.push(fragment);
  }

  if (suppressed.size > 0) {
    const filtered = collected.filter(
      ({ name, fragment }) => fragment !== undefined && !suppressed.has(name),
    );
    parts.length = 0;
    if (base) parts.push(base);
    for (const { fragment } of filtered) parts.push(fragment!);
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

// ── Tool filtering ────────────────────────────────────────────────────────────

/**
 * Apply every ToolSet's `onFilterTools` hook in registration order.
 * Returns the filtered tool list (may be the same reference when no ToolSet
 * filters anything).
 */
export function applyToolFilters<T extends Tool>(
  tools: readonly T[],
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
): readonly T[] {
  let current: readonly Tool[] = tools;
  for (const ts of toolSets) {
    if (ts.onFilterTools) current = ts.onFilterTools(ctx, current);
  }
  return current as readonly T[];
}

// ── ToolSet onAfterTurn composition ──────────────────────────────────────────

export type ComposedAfterTurnResult = {
  /** The final (possibly compacted) history. */
  history: AgentMessage[];
  /** All UI notices emitted by ToolSets during compaction (may be empty). */
  notices: readonly CompactionNotice[];
  /** `true` when any ToolSet returned a compaction result. */
  changed: boolean;
};

/**
 * Chain every ToolSet's `onAfterTurn` hook in registration order.
 *
 * Each ToolSet receives the history produced by the previous one, enabling
 * multi-stage compaction pipelines. Notices from all ToolSets are collected.
 *
 * Callers map the result to their own convention:
 * - Main agent (`sessionFactory.ts`): returns `CompactionResult | void`
 *   (includes `notices` for UI rendering).
 * - Sub-agent (`registry.ts`): returns `AgentMessage[] | void`
 *   (notices are dropped — sub-agents have no dedicated UI notice stream).
 */
export async function composeToolSetAfterTurn(
  history: AgentMessage[],
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
  usage: TokenUsage | undefined,
  signal: AbortSignal,
  handler: AgentHandler,
): Promise<ComposedAfterTurnResult> {
  let current = history;
  const notices: CompactionNotice[] = [];
  let changed = false;

  for (const ts of toolSets) {
    const r = await ts.onAfterTurn?.(ctx, current, usage, signal, handler);
    if (r) {
      current = r.history;
      if (r.notices?.length) notices.push(...r.notices);
      changed = true;
    }
  }

  return { history: current, notices, changed };
}
