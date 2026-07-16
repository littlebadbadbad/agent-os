import type {
  AgentMessage,
  Attachment,
  ToolCall,
  ToolResult,
  ToolChoice,
  ToolSet,
  ToolSetContext,
  ToolSetStateContext,
  AgentSessionState,
  Tool,
  AgentHandler,
} from "@agent-type";
import { MAIN_CONVERSATION_ID } from "../tools/toolSet";
import { createToolManager, type ToolManager } from "./toolManager";
import { createAgentSession } from "./agentSession";
import { buildHandlerContext } from "./handlerContext";
import { createToolSetScope } from "@agent-sdk/tools/toolSetScope";
import type { SessionEntryData } from "./sessionManager.types";
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

    // Canonical ToolSet context + unified scope for this session.
    const tsCtx: ToolSetContext = {
      sessionId,
      agentName: id ?? "main",
      conversationId: MAIN_CONVERSATION_ID,
    };
    const scope = createToolSetScope(getAllToolSets, handler);

    // Propagate all currently registered master tools.
    for (const tool of masterTools) {
      slot.registerTool(tool);
    }

    // Initialize all tool sets for this session.
    scope.initScope(tsCtx, entryData);

    // ── Pipeline and callTool ─────────────────────────────────────────────

    const pipeline = scope.createPipeline(tsCtx, () => slot.getRegistry(), flushPersistence);

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
      scope,
      tsCtx,
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
              scope,
              pipeline,
              sectionCache,
            ),
          ),
      callTool,
      maxAgentTurns,
      getExternalState: (prevState) => {
        const stateCtx: ToolSetStateContext = {
          tools: slot.getTools(),
          prevState,
        };
        return scope.collectState(tsCtx, stateCtx) as Partial<AgentSessionState>;
      },
      subscribeExternalState: (fn) => {
        slot.externalRefresh = fn;
        const unsub = scope.subscribeScope(tsCtx, fn);
        return () => {
          slot.externalRefresh = null;
          unsub();
        };
      },
      enableAttachments,
      onClearHistory: () => {
        sectionCache.invalidate();
        scope.resetScope(tsCtx);
      },
      onInterceptMessage: (
        text: string,
        attachments: readonly Attachment[] | undefined,
        isLoading: boolean,
      ): boolean => scope.interceptMessage(tsCtx, text, attachments, isLoading),
    });

    // Fire onReady for all ToolSets now that the session is fully wired.
    scope.readyScope(tsCtx, {
      sendMessage: (t) => session.sendMessage(t),
      injectToolResult: (id, name, result) => session.injectToolResult(id, name, result),
    });

    return session;
  };
}
