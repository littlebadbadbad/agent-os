/**
 * ToolSet Scope — Unified lifecycle orchestration for any agent scope.
 *
 * Both the main agent (session) and sub-agent (agent + conversation) follow
 * the same pattern: iterate ToolSets and call their lifecycle hooks with a
 * `ToolSetContext`.  This module provides a single factory that binds a
 * ToolSet list + handler into a complete set of scope operations, eliminating
 * the duplicated for-loop logic that was previously scattered across
 * `sessionFactory.ts`, `registryLifecycle.ts`, `registryExecution.ts`,
 * `handlerContext.ts`, `snapshotBuilder.ts`, and `registrySnapshot.ts`.
 *
 * Usage:
 * ```ts
 * const scope = createToolSetScope(() => getAllToolSets(), handler);
 * scope.initScope(ctx, entryData);
 * scope.readyScope(ctx, helpers);
 * const tools = scope.filterTools(allTools, ctx);
 * const prompt = scope.buildSystemPrompt(base, ctx, userMessage, cache);
 * const pipeline = scope.createPipeline(ctx, registry);
 * ```
 *
 * Every method is a thin wrapper over a pure function from `agentRuntime.ts`
 * or `sharedStateCollector.ts` — zero duplicate logic, zero class keyword.
 */

import type {
  AgentHandler,
  AgentMessage,
  AgentRunOutcome,
  Attachment,
  SessionEntryData,
  SessionReadyHelpers,
  Tool,
  TokenUsage,
  ToolSet,
  ToolSetContext,
  ToolSetStateContext,
} from '@agent-type';
import type { ToolCallPipeline } from './callToolPipeline';
import type { ToolRegistry } from './registry';
import type { SystemPromptCache } from '@agent-sdk/tools/prompts/section';
export type { SystemPromptCache };
import { buildSystemPrompt, applyToolFilters, composeToolSetAfterTurn, dispatchOnBeforeRun, dispatchOnAfterRun, dispatchOnBeforeInvoke, dispatchOnInterceptMessage, type ComposedAfterTurnResult } from './agentRuntime';
import { mergeAllToolSetStates, collectSnapshotData } from './sharedStateCollector';
import { createToolCallPipeline, withErrorBoundary } from './callToolPipeline';

// ── Factory ───────────────────────────────────────────────────────────────────

export type ToolSetScope = ReturnType<typeof createToolSetScope>;

export function createToolSetScope(
  toolSets: () => readonly ToolSet[],
  handler: AgentHandler,
  brand?: symbol,
) {
  function resolve(): readonly ToolSet[] {
    return toolSets();
  }

  return {

    // ═══════════════════════════════════════════════════════════════════════
    //  Scope Lifecycle
    // ═══════════════════════════════════════════════════════════════════════

    initScope(ctx: ToolSetContext, entryData?: SessionEntryData): void {
      const all = resolve();
      for (let i = 0; i < all.length; i++) all[i].onInit?.(ctx, entryData);
    },

    readyScope(ctx: ToolSetContext, helpers: SessionReadyHelpers): void {
      const all = resolve();
      for (let i = 0; i < all.length; i++) all[i].onReady?.(ctx, helpers);
    },

    resetScope(ctx: ToolSetContext): void {
      const all = resolve();
      for (let i = 0; i < all.length; i++) all[i].onReset?.(ctx);
    },

    removeScope(ctx: ToolSetContext): void {
      const all = resolve();
      for (let i = 0; i < all.length; i++) all[i].onRemove?.(ctx);
    },

    subscribeScope(ctx: ToolSetContext, fn: () => void): () => void {
      const unsubs: Array<() => void> = [];
      const all = resolve();
      for (let i = 0; i < all.length; i++) {
        const u = all[i].onSubscribe?.(ctx, fn);
        if (u) unsubs.push(u);
      }
      return () => {
        for (let i = 0; i < unsubs.length; i++) unsubs[i]();
      };
    },

    // ═══════════════════════════════════════════════════════════════════════
    //  Per-Run Dispatch
    // ═══════════════════════════════════════════════════════════════════════

    beforeRun(ctx: ToolSetContext, history: readonly AgentMessage[]): void {
      dispatchOnBeforeRun(resolve(), ctx, history);
    },

    afterRun(ctx: ToolSetContext, outcome: AgentRunOutcome): void {
      dispatchOnAfterRun(resolve(), ctx, outcome);
    },

    interceptMessage(
      ctx: ToolSetContext,
      text: string,
      attachments: readonly Attachment[] | undefined,
      isLoading: boolean,
    ): boolean {
      return dispatchOnInterceptMessage(resolve(), ctx, text, attachments, isLoading);
    },

    beforeInvoke(ctx: ToolSetContext): AgentMessage[] {
      return dispatchOnBeforeInvoke(resolve(), ctx);
    },

    // ═══════════════════════════════════════════════════════════════════════
    //  Per-Turn Operations
    // ═══════════════════════════════════════════════════════════════════════

    buildSystemPrompt(
      base: string | undefined,
      ctx: ToolSetContext,
      userMessage?: string,
      sectionCache?: SystemPromptCache,
    ): string | undefined {
      return buildSystemPrompt(base, resolve(), ctx, userMessage, sectionCache, brand);
    },

    filterTools(tools: readonly Tool[], ctx: ToolSetContext): readonly Tool[] {
      return applyToolFilters(tools, resolve(), ctx);
    },

    composeAfterTurn(
      history: AgentMessage[],
      ctx: ToolSetContext,
      usage: TokenUsage | undefined,
      signal: AbortSignal,
    ): Promise<ComposedAfterTurnResult> {
      return composeToolSetAfterTurn(history, resolve(), ctx, usage, signal, handler);
    },

    // ═══════════════════════════════════════════════════════════════════════
    //  Tool-Call Pipeline
    // ═══════════════════════════════════════════════════════════════════════

    createPipeline(
      ctx: ToolSetContext,
      registry: ToolRegistry | (() => ToolRegistry),
      flushPersistence?: () => Promise<void>,
    ): ToolCallPipeline {
      return withErrorBoundary(createToolCallPipeline({
        registry,
        toolSets,
        ctx,
        handler,
        flushPersistence,
      }));
    },

    // ═══════════════════════════════════════════════════════════════════════
    //  State & Snapshot
    // ═══════════════════════════════════════════════════════════════════════

    collectState(
      ctx: ToolSetContext,
      stateCtx: ToolSetStateContext,
    ): Record<string | symbol, unknown> {
      return mergeAllToolSetStates(resolve(), ctx, stateCtx);
    },

    collectSnapshot(ctx: ToolSetContext): Record<string, unknown> {
      return collectSnapshotData(resolve(), ctx);
    },
  };
}
