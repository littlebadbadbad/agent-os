import type {
  AgentMessage,
  ToolCall,
  ToolResult,
  TokenUsage,
  ToolChoice,
  AgentSessionExtension,
} from "@agent-type";
import {
  createToolCallPipeline,
  withErrorBoundary,
} from "@agent-sdk/tools/callToolPipeline";
import type {
  CompactionResult,
  ToolSet,
  ToolSetContext,
  ToolSetStateContext,
  AgentRunOutcome,
  AgentSessionState,
} from "@agent-type";
import { MAIN_CONVERSATION_ID } from "../tools/toolSet";
import type { Tool } from "@agent-type";
import { createToolManager, type ToolManager } from "./toolManager";
import { createAgentSession } from "./agentSession";
import { buildHandlerContext } from "./handlerContext";
import { composeToolSetAfterTurn } from "@agent-sdk/tools/agentRuntime";
import type { SessionEntryData } from "./sessionManager.types";
import type { AgentHandler } from "@agent-type";
import { createSystemPromptCache } from "@agent-sdk/tools/prompts/section";

export type SessionFactoryDeps = {
  masterTools: Tool[];
  slots: Map<string, ToolManager>;
  getAllToolSets: () => readonly ToolSet[];
  id: string;
  systemPrompt: string | undefined;
  toolChoice: ToolChoice | undefined;
  handler: AgentHandler;
  maxAgentTurns: number;
  enableAttachments: boolean;
  /**
   * Force-flush of debounced session-snapshot saves.
   *
   * Forwarded into every tool's `ToolExecutionContext.flushPersistence` so
   * that tools (notably the upgrade ToolSet) can guarantee state lands on
   * disk before destructive actions like `restart`.
   *
   * `undefined` when the AgentClient was constructed without persistence.
   */
  flushPersistence?: () => Promise<void>;
};

export function createSessionFactory(deps: SessionFactoryDeps) {
  const {
    masterTools,
    slots,
    getAllToolSets,
    id,
    systemPrompt,
    toolChoice,
    handler,
    maxAgentTurns,
    enableAttachments,
    flushPersistence,
  } = deps;

  return function makeSession(entryData: SessionEntryData) {
    const { id: sessionId } = entryData;

    // Per-session prompt-section cache — shared across all turns so that
    // cacheable sections (e.g. static tool usage guidance) are computed
    // once and reused.  Invalidated on session reset.
    const sectionCache = createSystemPromptCache();

    const slot = createToolManager(entryData);
    slots.set(sessionId, slot);

    // Canonical ToolSet context for this session (main agent).
    const tsCtx: ToolSetContext = {
      sessionId,
      agentName: id ?? "main",
      conversationId: MAIN_CONVERSATION_ID,
    };

    // Propagate all currently registered master tools.
    for (const tool of masterTools) {
      slot.registerTool(tool);
    }

    // Initialize all tool sets for this session.
    for (const ts of getAllToolSets()) {
      ts.onInitSession?.(tsCtx, entryData);
    }

    // ── Pipeline and callTool ─────────────────────────────────────────────

    const pipeline = withErrorBoundary(
      createToolCallPipeline({
        registry: () => slot.getRegistry(),
        toolSets: getAllToolSets, // lazy: resolved on every call so late-registered ToolSets always participate
        ctx: tsCtx,
        handler,
        flushPersistence,
      }),
    );

    function callTool(
      call: ToolCall,
      signal: AbortSignal,
    ): Promise<ToolResult> {
      return pipeline(call, signal);
    }

    const session = createAgentSession({
      id: sessionId,
      agentName: id,
      conversationId: MAIN_CONVERSATION_ID,
      agentId: id,
      title: entryData.title,
      initialMessages: entryData.messages ? [...entryData.messages] : undefined,
      liveHistory: entryData.liveHistory
        ? [...entryData.liveHistory]
        : undefined,
      getHandler:
        (userMessage?: string) => (msgs: AgentMessage[], signal: AbortSignal) =>
          handler(
            msgs,
            buildHandlerContext(
              slot,
              systemPrompt,
              toolChoice,
              sessionId,
              id ?? "main",
              signal,
              userMessage,
              getAllToolSets(),
              pipeline,
              sectionCache,
            ),
          ),
      callTool,
      maxAgentTurns,
      onAfterTurn: async (
        history: AgentMessage[],
        usage: TokenUsage | undefined,
        signal: AbortSignal,
      ): Promise<CompactionResult | void> => {
        const r = await composeToolSetAfterTurn(
          history,
          getAllToolSets(),
          tsCtx,
          usage,
          signal,
          handler,
        );
        return r.changed || r.notices.length > 0
          ? { history: r.history, notices: r.notices }
          : undefined;
      },
      getExternalState: (prevState) => {
        const merged: Partial<AgentSessionState> = {};
        const stateCtx: ToolSetStateContext = {
          tools: slot.getTools(),
          prevState,
        };
        for (const ts of getAllToolSets()) {
          if (ts.onGetState) {
            for (const [k, v] of Object.entries(
              ts.onGetState(tsCtx, stateCtx),
            )) {
              merged[k] =
                Array.isArray(v) && Array.isArray(merged[k])
                  ? [...merged[k], ...v]
                  : v;
            }
          }
          if (ts.onGetSymbolState && ts.symbol) {
            const existing = merged[ts.symbol];
            const symbolState: Record<string, unknown> =
              existing !== undefined
                ? { ...existing }
                : {};
            for (const [k, v] of Object.entries(
              ts.onGetSymbolState(tsCtx, stateCtx),
            )) {
              symbolState[k] = v;
            }
            merged[ts.symbol] = symbolState;
          }
        }
        return merged;
      },
      subscribeExternalState: (fn) => {
        slot.externalRefresh = fn;
        const unsubs: Array<() => void> = [];
        for (const ts of getAllToolSets()) {
          if (ts.onSubscribe) unsubs.push(ts.onSubscribe(tsCtx, fn));
        }
        return () => {
          slot.externalRefresh = null;
          unsubs.forEach((u) => u());
        };
      },
      enableAttachments,
      onClearHistory: () => {
        sectionCache.invalidate();
        for (const ts of getAllToolSets()) ts.onResetSession?.(tsCtx);
      },
      onBeforeRun: (history) => {
        for (const ts of getAllToolSets()) ts.onBeforeRun?.(tsCtx, history);
      },
      onBeforeInvoke: () =>
        getAllToolSets().flatMap((ts) => ts.onBeforeInvoke?.(tsCtx) ?? []),
      onAfterRun: (outcome: AgentRunOutcome) => {
        for (const ts of getAllToolSets()) ts.onAfterRun?.(tsCtx, outcome);
      },
    });

    // Fire onSessionReady for all ToolSets now that sendMessage is available.
    for (const ts of getAllToolSets()) {
      ts.onSessionReady?.(tsCtx, (t) => session.sendMessage(t));
    }

    return session;
  };
}
