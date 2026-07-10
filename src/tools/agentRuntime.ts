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

import type { Tool, AgentMessage, TokenUsage, AgentHandler, ToolSet, ToolSetContext, SystemPromptContext, CompactionNotice, SectionId } from '@agent-type';
import type { Attachment, AgentRunOutcome } from '@agent-type';
import type { SystemPromptCache } from '@agent-sdk/tools/prompts/section';
import { canSuppressPrompt } from './toolSet';
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
 * **Ordering**: ToolSets that declare a `sectionPriority` are sorted ascending.
 * ToolSets without a `sectionPriority` (or with `undefined`) appear after all
 * sorted ToolSets, in their original registration order.
 *
 * **Deduplication**: When two or more ToolSets share the same `sectionId`,
 * only the one with the lowest `sectionPriority` is included.  The rest are
 * skipped.  ToolSets without a `sectionId` are never deduplicated.
 *
 * **Caching**: When a `sectionCache` is provided and the ToolSet has a
 * `sectionId`, the fragment is resolved through `SystemPromptCache.resolve()`,
 * which returns a cached value if the section was already computed and its
 * `cacheable` flag is `true`.
 *
 * @param base          Optional base system prompt (injected first).
 * @param toolSets      ToolSets whose `onGetSystemPrompt` to invoke.
 * @param ctx           Stable session/agent context for this turn.
 * @param userMessage   The raw user message text, or `undefined` for
 *                      programmatic calls.
 * @param sectionCache  Optional per-session cache.  When provided, sections
 *                      with a `sectionId` are cached and reused on subsequent
 *                      turns until `sectionCache.invalidate()` is called.
 * @returns The joined prompt, or `undefined` when nothing was injected.
 */
export function buildSystemPrompt(
  base: string | undefined,
  toolSets: readonly ToolSet[],
  ctx: ToolSetContext,
  userMessage?: string,
  sectionCache?: SystemPromptCache,
): string | undefined {
  const parts: string[] = [];
  if (base) parts.push(base);

  // 1. Separate ToolSets with a sectionId from those without.
  //    Section-aware ToolSets are sorted and deduplicated.
  //    Section-unaware ToolSets are injected unconditionally in order.
  const withSection: ToolSet[] = [];
  const withoutSection: ToolSet[] = [];
  for (const ts of toolSets) {
    if (ts.sectionId) {
      withSection.push(ts);
    } else {
      withoutSection.push(ts);
    }
  }

  // 2. Sort by sectionPriority ascending, then deduplicate by sectionId.
  const seen = new Set<SectionId>();
  const ordered = [...withSection]
    .sort((a, b) => (a.sectionPriority ?? 100) - (b.sectionPriority ?? 100))
    .filter((ts) => {
      const id = ts.sectionId!;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  // 3. Compute each section fragment, optionally caching.
  //    ToolSets may call `suppressToolSetPrompt` to request that another
  //    ToolSet's fragment be excluded from the final prompt.  Suppression
  //    does NOT prevent the target's `onGetSystemPrompt` from executing —
  //    only its result is discarded.
  const allOrdered = [...ordered, ...withoutSection];

  /** Names of ToolSets whose prompt fragment should be suppressed. */
  const suppressed = new Set<string>();
  /** Collected { name, fragment } pairs — filtered after the loop. */
  const collected: Array<{ name: string; fragment: string | undefined }> = [];

  for (const ts of allOrdered) {
    // Only branded ToolSets (e.g. ToolStateToolSet) are authorised to
    // suppress other ToolSets' prompts.  Non-branded ToolSets receive a
    // no-op so they cannot interfere with each other's fragments.
    const promptCtx: SystemPromptContext = {
      userMessage,
      baseSystemPrompt: base,
      currentSystemPromptParts: [...parts],
      suppressToolSetPrompt: canSuppressPrompt(ts)
        ? (name: string) => { suppressed.add(name); }
        : () => { /* no-op: only branded ToolSets can suppress */ },
    };

    const compute = () => ts.onGetSystemPrompt?.(ctx, promptCtx, toolSets);
    const fragment = ts.sectionId && sectionCache
      ? sectionCache.resolve(ts.sectionId, compute as () => string | undefined)
      : compute();

    collected.push({ name: ts.name, fragment });
    // Tentatively add to `parts` so later ToolSets see it in
    // `currentSystemPromptParts`.  Suppressed fragments are removed in
    // the post-loop filter below.
    if (fragment) parts.push(fragment);
  }

  // 4. Post-filter: remove fragments from ToolSets that were suppressed
  //    after their fragment was already added to `parts`.
  if (suppressed.size > 0) {
    const filtered = collected.filter(
      ({ name, fragment }) => fragment !== undefined && !suppressed.has(name),
    );
    // Rebuild parts from scratch: base + surviving fragments.
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
