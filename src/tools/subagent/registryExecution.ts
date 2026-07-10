/**
 * Sub-agent execution core.
 *
 * Contains the shared execution logic used by both `sendMessage` and
 * `editConversationMessage`: building the system prompt, wiring ToolSet
 * hooks, running the agent loop, and updating conversation state.
 *
 * Exported as a factory to capture closure dependencies without repetitive
 * parameter passing.
 */

import type { AgentMessage, TokenUsage } from '@agent-type';
import type { Attachment } from '@agent-type';
import type { SubAgentResult } from './types';
import { truncateAtUserMessage } from '../historyUtils';
import { runAgentLoop } from './loop';
import { emptyRegistry, withTool } from '../registry';
import { createToolCallPipeline, withErrorBoundary } from '../callToolPipeline';
import { buildSystemPrompt, applyToolFilters, composeToolSetAfterTurn, wrapOnBeforeInvoke, dispatchOnBeforeRun, dispatchOnAfterRun, dispatchOnBeforeInvoke, dispatchOnInterceptMessage } from '../agentRuntime';
import type { InternalEntry, RegistryDeps } from './registryInternal';
import type { ConversationHandle } from './registryConversation';

// ── Execution options ────────────────────────────────────────────────────────

export type SendMessageOpts = {
  /** Parent session ID — forwarded to runAgentLoop so nested tool calls key the correct registry. */
  sessionId: string;
  signal: AbortSignal;
  attachments?: readonly Attachment[];
};

// ── Factory ──────────────────────────────────────────────────────────────────

export type ExecutionFunctions = {
  executeConversation(
    entry: InternalEntry,
    conv: ConversationHandle,
    message: string,
    openingUserMsg: AgentMessage,
    priorHistory: AgentMessage[],
    opts: SendMessageOpts,
  ): Promise<SubAgentResult>;

  sendMessage(
    subAgentName: string,
    conversationId: string,
    message: string,
    opts: SendMessageOpts,
  ): Promise<SubAgentResult>;

  editConversationMessage(
    subAgentName: string,
    conversationId: string,
    userCount: number,
    newText: string,
    opts: SendMessageOpts,
  ): Promise<SubAgentResult>;
};

/**
 * Create execution functions bound to a set of shared dependencies.
 *
 * @param deps      Registry-level deps (subCtx, resolveToolSets, resolveTools, handler).
 * @param entries   Mutable map of agent entries (used for lookup in send/edit).
 */
export function createExecutionFunctions(
  deps: RegistryDeps,
  entries: Map<string, InternalEntry>,
): ExecutionFunctions {
  // ── Shared execution core ─────────────────────────────────────────────────

  /**
   * Shared execution core used by both `sendMessage` and
   * `editConversationMessage`.  Callers are responsible for setting up
   * `openingUserMsg` and `priorHistory` (history WITHOUT the new user turn)
   * before calling this helper.
   *
   * Appends `openingUserMsg` to both live and full history via the tracker,
   * runs the sub-agent loop, persists the resulting full history, and
   * returns the result.
   */
  async function executeConversation(
    entry: InternalEntry,
    conv: ConversationHandle,
    message: string,
    openingUserMsg: AgentMessage,
    priorHistory: AgentMessage[],
    opts: SendMessageOpts,
  ): Promise<SubAgentResult> {
    const state = conv._state;

    // Immediately append the user message so the UI can display it
    // before the sub-agent loop begins processing.
    state.tracker.pushToBoth(openingUserMsg);
    state.tracker.setTurnStart(state.tracker.getLiveHistory().length);
    state.isLoading = true;
    state.streamingText = '';
    conv._notifyRegistry();

    const turnCtx = deps.subCtx(entry.name, state.id);
    // Notify ToolSets so they can process the incoming user turn (e.g. the
    // variable ToolSet stores any attachments in the user message as variables,
    // making them accessible via var_read for the duration of this sub-agent turn).
    dispatchOnBeforeRun(deps.resolveToolSets(), turnCtx, state.tracker.getLiveHistory());

    // onAfterTurn: update history after every turn (so tool calls appear
    // incrementally), then delegate token recording and optional summarisation
    // to ToolSet.onAfterTurn hooks. ToolSet.onGetState is queried lazily at
    // snapshot time — no manual state copy needed here.
    const onAfterTurn = async (
      history: AgentMessage[],
      usage: TokenUsage | undefined,
      signal: AbortSignal,
    ): Promise<AgentMessage[] | void> => {
      state.streamingText = '';

      const r = await composeToolSetAfterTurn(history, deps.resolveToolSets(), turnCtx, usage, signal, deps.handler);
      if (r.changed) {
        state.tracker.advanceTurn(r.history);
      } else {
        state.tracker.advanceTurn(history);
      }

      // Surface compaction notices as assistant messages in the sub-agent
      // chat — mirroring the main agent which injects them via setMessages.
      for (const notice of r.notices ?? []) {
        state.tracker.pushToBoth({
          role: 'assistant' as const,
          content: notice.content,
          ...(notice.attachments ? { attachments: notice.attachments } : {}),
        });
      }

      conv._notifyRegistry();
      return r.changed ? r.history : undefined;
    };

    let outcome: import('@agent-type').AgentRunOutcome = 'error';

    // ── Batched streaming text ───────────────────────────────────────
    // Accumulate deltas per animation frame (mirrors main agent's
    // makeBatchedAppender) so React re-renders at most once per frame
    // instead of once per ~5-char chunk.
    // Declared outside try so the finally block can flush & cancel.
    let pendingTextDelta = '';
    let rafId: ReturnType<typeof requestAnimationFrame> | undefined;
    function flushTextDelta(): void {
      if (pendingTextDelta) {
        state.streamingText += pendingTextDelta;
        pendingTextDelta = '';
        conv._notify();
      }
      rafId = undefined;
    }

    try {
      const fullSystemPrompt = buildSystemPrompt(entry.systemPrompt, deps.resolveToolSets(), turnCtx, message, entry.sectionCache);
      const tools = applyToolFilters(deps.resolveTools(entry.toolNames), deps.resolveToolSets(), turnCtx);

      // Build a tool registry and pipeline so ToolSet hooks (variable resolution,
      // result interception) apply uniformly to this sub-agent's tool calls.
      const subRegistry = tools.reduce((r, t) => withTool(r, t), emptyRegistry());
      const pipeline = withErrorBoundary(createToolCallPipeline({
        registry: subRegistry,
        toolSets: deps.resolveToolSets(),
        ctx: turnCtx,
        handler: deps.handler,
      }));

      const result = await runAgentLoop({
        message,
        handler: deps.handler,
        tools,
        maxTurns: entry.maxTurns,
        systemPrompt: fullSystemPrompt,
        signal: opts.signal,
        agentName: entry.name,
        conversationId: state.id,
        sessionId: opts.sessionId,
        initialHistory: priorHistory,
        attachments: opts.attachments,
        callTool: (call) => pipeline(call, opts.signal),
        onBeforeInvoke: wrapOnBeforeInvoke(
          () => dispatchOnBeforeInvoke(deps.resolveToolSets(), turnCtx),
          state.tracker,
          () => conv._notifyRegistry(),
        ),
        onAfterTurn,
        onTextDelta: (delta) => {
          pendingTextDelta += delta;
          if (rafId === undefined) {
            rafId = requestAnimationFrame(flushTextDelta);
          }
        },
      });

      // Final history is already up-to-date from onAfterTurn; set it here as
      // a safety net in case onAfterTurn wasn't called (e.g. single turn).
      state.tracker.advanceTurn(result.history);

      outcome = opts.signal.aborted
        ? 'aborted'
        : result.turns >= entry.maxTurns ? 'max-turns' : 'completed';

      return result;
    } catch (_err) {
      outcome = opts.signal.aborted ? 'aborted' : 'error';
      throw _err;
    } finally {
      state.tracker.reconcile();
      // Flush any batched text delta that hasn't been committed yet,
      // then cancel the pending rAF to avoid a stale callback.
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      flushTextDelta();
      // Set isLoading BEFORE onAfterRun so implementations (e.g.
      // PendingInputToolSet) can call sendMessage synchronously —
      // onInterceptMessage sees isLoading=false and passes through
      // immediately, starting the next run without re-queuing.
      state.streamingText = '';
      state.isLoading = false;
      conv._notifyRegistry();
      // Fire post-run hooks after isLoading is cleared.
      dispatchOnAfterRun(deps.resolveToolSets(), turnCtx, outcome);
    }
  }

  // ── Send message ─────────────────────────────────────────────────────────

  /**
   * Core send function used by both the tool layer and the UI layer.
   * Appends `message` as a user turn, runs the sub-agent loop,
   * persists the resulting full history, and returns the result.
   */
  async function sendMessage(
    subAgentName: string,
    conversationId: string,
    message: string,
    opts: SendMessageOpts,
  ): Promise<SubAgentResult> {
    const entry = entries.get(subAgentName);
    if (!entry) throw new Error(`Sub-agent "${subAgentName}" not found.`);
    const conv = entry.conversations.get(conversationId);
    if (!conv) {
      throw new Error(`Conversation "${conversationId}" not found on sub-agent "${subAgentName}".`);
    }

    // ToolSet intercept check — plugins can queue the message while the agent
    // is busy (e.g. pending-input plugin). Runs BEFORE the isLoading guard so
    // that programmatic sends from tools (e.g. send_async_message) also hit
    // the interceptor.
    const interceptCtx = deps.subCtx(subAgentName, conversationId);
    if (dispatchOnInterceptMessage(deps.resolveToolSets(), interceptCtx, message, opts.attachments, conv._state.isLoading)) {
      return { output: '', turns: 0, toolCallCount: 0, history: conv._state.tracker.getLiveHistory() } satisfies SubAgentResult;
    }

    // Concurrency guard: prevent two parallel sends from corrupting the same
    // conversation's history and isLoading flag.
    if (conv._state.isLoading) {
      throw new Error(
        `[sub-agent:${subAgentName}] Conversation "${conversationId}" is already running. ` +
        `Wait for the current turn to complete before sending another message.`,
      );
    }

    const priorHistory = conv._state.tracker.getLiveHistory();
    const openingUserMsg: AgentMessage = opts.attachments?.length
      ? { role: 'user', content: message, attachments: opts.attachments }
      : { role: 'user', content: message };
    return executeConversation(entry, conv, message, openingUserMsg, priorHistory, opts);
  }

  // ── Edit conversation message ───────────────────────────────────────────

  /**
   * Edit function for UI-initiated message edits.
   * Finds the `userCount`-th user message in `fullHistory` (1-based),
   * destructively truncates both histories at that point, resets the LLM
   * context, then runs the same agent loop as `sendMessage`.
   *
   * All ToolSet lifecycle hooks (`onBeforeRun`, `onAfterTurn`, etc.) fire
   * identically to a normal send — this is intentional
   * tracking, variable injection, etc. behave the same way.
   */
  async function editConversationMessage(
    subAgentName: string,
    conversationId: string,
    userCount: number,
    newText: string,
    opts: SendMessageOpts,
  ): Promise<SubAgentResult> {
    const entry = entries.get(subAgentName);
    if (!entry) throw new Error(`Sub-agent "${subAgentName}" not found.`);
    const conv = entry.conversations.get(conversationId);
    if (!conv) {
      throw new Error(`Conversation "${conversationId}" not found on sub-agent "${subAgentName}".`);
    }

    if (conv._state.isLoading) {
      throw new Error(
        `[sub-agent:${subAgentName}] Conversation "${conversationId}" is already running. ` +
        `Wait for the current turn to complete before editing.`,
      );
    }

    // Use fullHistory (never compacted) to find the Nth real user message.
    const truncResult = truncateAtUserMessage(conv._state.tracker.getFullHistory(), userCount);
    if (truncResult.userIndex === -1) {
      throw new Error(
        `[sub-agent:${subAgentName}] Cannot find user message ${userCount} in conversation "${conversationId}".`,
      );
    }

    // Destructively truncate the old branch from both histories.
    conv._state.tracker.replaceBoth(truncResult.history, truncResult.fullHistory);

    const priorHistory = conv._state.tracker.getLiveHistory();
    const openingUserMsg: AgentMessage = opts.attachments?.length
      ? { role: 'user', content: newText, attachments: opts.attachments }
      : { role: 'user', content: newText };
    return executeConversation(entry, conv, newText, openingUserMsg, priorHistory, opts);
  }

  // ── Return bound functions ────────────────────────────────────────────────

  return {
    executeConversation,
    sendMessage,
    editConversationMessage,
  };
}
