/**
 * Sub-agent execution core.
 *
 * Simplified to delegate all conversation execution to a shared
 * {@link ConversationRunner}, identical to how {@link AgentSession} now works.
 *
 * Previously this file contained ~200 lines of duplicated agent-loop logic
 * (runSubAgentLoop, streaming batchers, onAfterTurn, error handling) that
 * mirrored {@code runInternalAgentLoop} in agentSession.ts.  All of that now
 * lives once in conversationRunner.ts.
 *
 * @module
 */

import type { AgentMessage } from '@agent-type';
import type { Attachment } from '@agent-type';
import type { SubAgentResult } from './types';
import { truncateAtUserMessage } from '../historyUtils';
import { toDescriptors } from '../toDescriptor';
import { emptyRegistry, withTool } from '../registry';
import { createConversationRunner } from '@agent-sdk/tools/conversationRunner';
import type { InternalEntry } from './registryInternal';
import type { ConversationHandle } from './registryConversation';
import type { ToolSetScope } from '@agent-sdk/tools/toolSetScope';
import type { ToolSetContext, Tool } from '@agent-type';
import type { EngineRefs } from '@agent-sdk/tools/conversationEngine';

// ── Execution options ────────────────────────────────────────────────────────

export type SendMessageOpts = {
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

  injectToolResultIntoConversation(
    entry: InternalEntry,
    conv: ConversationHandle,
    toolCallId: string,
    name: string,
    result: unknown,
    opts: SendMessageOpts,
  ): Promise<SubAgentResult>;
};

export function createExecutionFunctions(
  deps: {
    subCtx: (agentName: string, conversationId: string) => ToolSetContext;
    resolveTools: (toolNames: readonly string[]) => Tool[];
    handler: import('@agent-type').AgentHandler;
    scope: ToolSetScope;
  },
  entries: Map<string, InternalEntry>,
): ExecutionFunctions {
  // ── Shared execution core ─────────────────────────────────────────────────
  //
  // Creates a ConversationRunner for the given entry + conversation and
  // delegates the actual agent loop to it.  Returns SubAgentResult by
  // extracting output and turn count from the tracker after the run.

  async function executeConversation(
    entry: InternalEntry,
    conv: ConversationHandle,
    message: string,
    openingUserMsg: AgentMessage,
    priorHistory: AgentMessage[],
    opts: SendMessageOpts,
  ): Promise<SubAgentResult> {
    const state = conv._state;
    const turnCtx = deps.subCtx(entry.name, state.id);

    // Build the per-run pipeline (once, not per-turn) from the entry's
    // resolved tools and filtered tool set.
    const fullSystemPrompt = deps.scope.buildSystemPrompt(entry.systemPrompt, turnCtx, message, entry.sectionCache);
    const tools = deps.scope.filterTools(deps.resolveTools(entry.toolNames), turnCtx);
    const subRegistry = tools.reduce((r, t) => withTool(r, t), emptyRegistry());
    const pipeline = deps.scope.createPipeline(turnCtx, subRegistry);

    // Mutable reference so invokeHandler and runToolCall share the pipeline.
    const pipelineRef: { current?: (call: import('@agent-type').ToolCall) => Promise<import('@agent-type').ToolResult> } = {};

    // Engine refs managed by runEngine inside ConversationRunner.
    const refs: EngineRefs = { isLoading: false, abortController: null };
    let toolCallCount = 0;

    const runner = createConversationRunner({
      msgList: state.msgList,
      tracker: state.tracker,
      refs,
      scope: deps.scope,
      tsCtx: turnCtx,
      maxAgentTurns: entry.maxTurns,

      notify: (isLoading) => {
        state.isLoading = isLoading;
        conv._notifyRegistry();
      },

      invokeHandler: (msgs, signal, _userText) => {
        pipelineRef.current = (call) => pipeline(call, signal);
        return deps.handler(msgs, {
          tools: toDescriptors(tools),
          callTool: (call) => pipeline(call, signal),
          toolChoice: 'auto',
          systemPrompt: fullSystemPrompt,
          signal,
        });
      },

      runToolCall: (call) => {
        toolCallCount++;
        return pipelineRef.current!(call);
      },

      onInterceptMessage: (text, attachments, isLoading) =>
        deps.scope.interceptMessage(turnCtx, text, attachments, isLoading),
    });

    // Push the user message before running.
    state.tracker.pushToBoth(openingUserMsg);
    state.tracker.setTurnStart(state.tracker.getLiveHistory().length);

    // Delegate to the unified conversation runner.
    await runner.sendMessage(message, opts.attachments);

    // Extract result metadata from the tracker after the run completes.
    const history = state.tracker.getLiveHistory();
    const output = extractAssistantOutput(history);
    state.tracker.reconcile();

    return {
      output,
      turns: runner.lastRun?.turns ?? 0,
      toolCallCount,
      history,
    } satisfies SubAgentResult;
  }

  // ── injectToolResultIntoConversation ──────────────────────────────────────

  async function injectToolResultIntoConversation(
    entry: InternalEntry,
    conv: ConversationHandle,
    toolCallId: string,
    name: string,
    result: unknown,
    opts: SendMessageOpts,
  ): Promise<SubAgentResult> {
    const state = conv._state;
    if (state.isLoading) {
      return { output: '', turns: 0, toolCallCount: 0, history: state.tracker.getLiveHistory() } satisfies SubAgentResult;
    }

    // Build a minimal runner to delegate injectToolResult to the shared
    // implementation (which handles tracker + msgList push and loop start).
    const turnCtx = deps.subCtx(entry.name, state.id);
    const refs: EngineRefs = { isLoading: false, abortController: null };
    let toolCallCount = 0;

    const runner = createConversationRunner({
      msgList: state.msgList,
      tracker: state.tracker,
      refs,
      scope: deps.scope,
      tsCtx: turnCtx,
      maxAgentTurns: entry.maxTurns,

      notify: (isLoading) => {
        state.isLoading = isLoading;
        conv._notifyRegistry();
      },

      invokeHandler: (msgs, signal, _userText) => {
        const fullSystemPrompt = deps.scope.buildSystemPrompt(entry.systemPrompt, turnCtx, _userText, entry.sectionCache);
        const tools = deps.scope.filterTools(deps.resolveTools(entry.toolNames), turnCtx);
        const subRegistry = tools.reduce((r, t) => withTool(r, t), emptyRegistry());
        const pipeline = deps.scope.createPipeline(turnCtx, subRegistry);
        return deps.handler(msgs, {
          tools: toDescriptors(tools),
          callTool: (call) => pipeline(call, signal),
          toolChoice: 'auto',
          systemPrompt: fullSystemPrompt,
          signal,
        });
      },

      runToolCall: (call) => {
        toolCallCount++;
        // Build pipeline on demand — tool calls from injectToolResult may
        // arrive before invokeHandler has been called.
        const tools = deps.scope.filterTools(deps.resolveTools(entry.toolNames), turnCtx);
        const subRegistry = tools.reduce((r, t) => withTool(r, t), emptyRegistry());
        const pipeline = deps.scope.createPipeline(turnCtx, subRegistry);
        return pipeline(call, opts.signal);
      },

      onInterceptMessage: (text, attachments, isLoading) =>
        deps.scope.interceptMessage(turnCtx, text, attachments, isLoading),
    });

    await runner.injectToolResult(toolCallId, name, result);

    const history = state.tracker.getLiveHistory();
    const output = extractAssistantOutput(history);
    state.tracker.reconcile();

    return {
      output,
      turns: runner.lastRun?.turns ?? 0,
      toolCallCount,
      history,
    } satisfies SubAgentResult;
  }

  // ── Send message ─────────────────────────────────────────────────────────

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
    // programmatic sends from tools also hit the interceptor.
    const interceptCtx = deps.subCtx(subAgentName, conversationId);
    if (deps.scope.interceptMessage(interceptCtx, message, opts.attachments, conv._state.isLoading)) {
      return { output: '', turns: 0, toolCallCount: 0, history: conv._state.tracker.getLiveHistory() } satisfies SubAgentResult;
    }

    // Concurrency guard.
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

    const truncResult = truncateAtUserMessage(conv._state.tracker.getFullHistory(), userCount);
    if (truncResult.userIndex === -1) {
      throw new Error(
        `[sub-agent:${subAgentName}] Cannot find user message ${userCount} in conversation "${conversationId}".`,
      );
    }

    conv._state.tracker.replaceBoth(truncResult.history, truncResult.fullHistory);

    const priorHistory = conv._state.tracker.getLiveHistory();
    const openingUserMsg: AgentMessage = opts.attachments?.length
      ? { role: 'user', content: newText, attachments: opts.attachments }
      : { role: 'user', content: newText };
    return executeConversation(entry, conv, newText, openingUserMsg, priorHistory, opts);
  }

  // ── Return bound functions ─────────────────────────────────────────────

  return {
    executeConversation,
    sendMessage,
    editConversationMessage,
    injectToolResultIntoConversation,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Extract the final assistant text from a message history.
 * Returns the text of the last assistant message, or empty string.
 */
function extractAssistantOutput(history: readonly AgentMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content) {
      return msg.content;
    }
  }
  return '';
}
