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
import { runAgentLoop } from './loop';
import { emptyRegistry, withTool } from '../registry';
import { createToolCallPipeline, withErrorBoundary } from '../callToolPipeline';
import { buildSystemPrompt, applyToolFilters, composeToolSetAfterTurn } from '../agentRuntime';
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
   * Appends `openingUserMsg` to `state.history` and `state.fullHistory`,
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
    state.history = [...priorHistory, openingUserMsg];
    state.fullHistory.push(openingUserMsg);
    // Tracks the slice boundary for incrementally appending to fullHistory each turn.
    let nextTurnStart = state.history.length;
    state.isLoading = true;
    state.streamingText = '';
    conv._notifyRegistry();

    const turnCtx = deps.subCtx(entry.name, state.id);
    // Notify ToolSets so they can process the incoming user turn (e.g. the
    // variable ToolSet stores any attachments in the user message as variables,
    // making them accessible via var_read for the duration of this sub-agent turn).
    for (const ts of deps.resolveToolSets()) {
      ts.onBeforeRun?.(turnCtx, state.history);
    }

    // onAfterTurn: update history after every turn (so tool calls appear
    // incrementally), then delegate token recording and optional summarisation
    // to ToolSet.onAfterTurn hooks. ToolSet.onGetState is queried lazily at
    // snapshot time — no manual state copy needed here.
    const onAfterTurn = async (
      history: AgentMessage[],
      usage: TokenUsage | undefined,
      signal: AbortSignal,
    ): Promise<AgentMessage[] | void> => {
      // Append any messages added this turn to the full (non-compacted) record.
      state.fullHistory.push(...history.slice(nextTurnStart));
      state.history = history;
      state.streamingText = '';

      // Notices are sub-agent-internal and have no dedicated UI stream here;
      // they are intentionally dropped (the compacted history is all we need).
      const r = await composeToolSetAfterTurn(history, deps.resolveToolSets(), turnCtx, usage, signal, deps.handler);
      if (r.changed) {
        state.history = r.history;
        nextTurnStart = r.history.length;
      } else {
        nextTurnStart = history.length;
      }

      conv._notifyRegistry();
      return r.changed ? r.history : undefined;
    };

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
        onBeforeInvoke: () =>
          deps.resolveToolSets().flatMap((ts) => ts.onBeforeInvoke?.(turnCtx) ?? []),
        onAfterTurn,
        onTextDelta: (delta) => {
          state.streamingText += delta;
          // Text streaming is high-frequency; notify only conv subscribers (not registry).
          conv._notify();
        },
      });

      // Final history is already up-to-date from onAfterTurn; set it here as
      // a safety net in case onAfterTurn wasn't called (e.g. single turn).
      state.history = result.history;
      return result;
    } finally {
      // Reconcile fullHistory: merge any messages written to `history` during
      // turns that completed before an abort fired (safety net for partial turns).
      if (state.fullHistory.length < state.history.length) {
        state.fullHistory.push(...state.history.slice(state.fullHistory.length));
      }
      // isLoading change is structural — update the registry snapshot.
      state.streamingText = '';
      state.isLoading = false;
      conv._notifyRegistry();
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

    // Concurrency guard: prevent two parallel sends from corrupting the same
    // conversation's history and isLoading flag.
    if (conv._state.isLoading) {
      throw new Error(
        `[sub-agent:${subAgentName}] Conversation "${conversationId}" is already running. ` +
        `Wait for the current turn to complete before sending another message.`,
      );
    }

    const priorHistory = [...conv._state.history];
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
    let fhUserIdx = -1;
    let fhUserFound = 0;
    for (let i = 0; i < conv._state.fullHistory.length; i++) {
      if (conv._state.fullHistory[i].role === 'user') {
        fhUserFound++;
        if (fhUserFound === userCount) { fhUserIdx = i; break; }
      }
    }
    if (fhUserIdx === -1) {
      throw new Error(
        `[sub-agent:${subAgentName}] Cannot find user message ${userCount} in conversation "${conversationId}".`,
      );
    }

    // Destructively truncate the old branch from both histories.
    conv._state.fullHistory = conv._state.fullHistory.slice(0, fhUserIdx);
    // Resync LLM context from fullHistory — drops any stale compaction anchors
    // that are no longer valid after the branch is discarded.
    conv._state.history = [...conv._state.fullHistory];

    const priorHistory = [...conv._state.history];
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
