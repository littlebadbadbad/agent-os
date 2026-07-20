

import type { AgentMessage } from '@agent-type';
import type { Attachment } from '@agent-type';
import type { SubAgentResult } from './types';
import { truncateAtUserMessage } from '../historyUtils';
import type { InternalEntry } from './registryInternal';
import type { ConversationHandle } from './registryConversation';
import type { ToolSetScope } from '@agent-sdk/tools/toolSetScope';
import type { ToolSetContext, Tool, AgentHandler } from '@agent-type';

// ── Execution options ────────────────────────────────────────────────────────

export type SendMessageOpts = {
  sessionId: string;
  signal: AbortSignal;
  attachments?: readonly Attachment[];
};

// ── Factory ──────────────────────────────────────────────────────────────────

export type ExecutionFunctions = {
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

export function createExecutionFunctions(
  deps: {
    subCtx: (agentName: string, conversationId: string) => ToolSetContext;
    resolveTools: (toolNames: readonly string[]) => Tool[];
    handler: AgentHandler;
    scope: ToolSetScope;
  },
  entries: Map<string, InternalEntry>,
): ExecutionFunctions {
  // ── Shared result extraction ─────────────────────────────────────────────

  function extractResult(conv: ConversationHandle): SubAgentResult {
    const history = conv._state.tracker.getLiveHistory();
    const output = extractAssistantOutput(history);
    conv._state.tracker.reconcile();
    return {
      output,
      turns: conv._state.runner?.lastRun?.turns ?? 0,
      toolCallCount: conv._state.runner?.lastRun?.toolCallCount ?? 0,
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

    // Concurrency guard — silent return (consistent with main agent behavior).
    if (conv._state.isLoading) {
      return { output: '', turns: 0, toolCallCount: 0, history: conv._state.tracker.getLiveHistory() } satisfies SubAgentResult;
    }

    // Auto-set conversation title from first user message.
    // Empty title means no custom title has been set yet — replace with the
    // actual first message text, truncating to 60 characters.
    // Notify immediately so the ConversationNavigator title bar reflects
    // the change without waiting for the runner to complete.
    if (message.length > 0 && !conv._state.title) {
      const t = message.length <= 60 ? message : message.slice(0, 57) + '…';
      conv._state.title = t;
      conv._notifyRegistry();
    }

    // Delegate to the persistent ConversationRunner — exactly like the
    // main agent's `AgentSession.sendMessage`.
    if (!conv._state.runner) {
      throw new Error(`Conversation "${conversationId}" has no runner.`);
    }
    await conv._state.runner.sendMessage(message, opts.attachments);
    return extractResult(conv);
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

    // Intercept message so ToolSets (e.g. user-input) can cancel pending prompts.
    const interceptCtx = deps.subCtx(subAgentName, conversationId);
    if (deps.scope.interceptMessage(interceptCtx, newText, opts.attachments, conv._state.isLoading)) {
      return { output: '', turns: 0, toolCallCount: 0, history: conv._state.tracker.getLiveHistory() } satisfies SubAgentResult;
    }

    if (!conv._state.runner) {
      throw new Error(`Conversation "${conversationId}" has no runner.`);
    }

    // Truncate tracker history before delegating to editAndSendMessage.
    // We use userCount directly (unlike the runner's messageId-based lookup)
    // because the subagent API is userCount-based.
    const truncResult = truncateAtUserMessage(conv._state.tracker.getFullHistory(), userCount);
    if (truncResult.userIndex === -1) {
      throw new Error(
        `[sub-agent:${subAgentName}] Cannot find user message ${userCount} in conversation "${conversationId}".`,
      );
    }
    conv._state.tracker.replaceBoth(truncResult.history, truncResult.fullHistory);

    // Find the message ID in msgList for the target userCount,
    // then delegate to the runner's editAndSendMessage.
    let userMsgIdx = 0;
    let targetId: string | undefined;
    for (const m of conv._state.msgList.messages) {
      if (m.role === 'user') userMsgIdx++;
      if (userMsgIdx === userCount) { targetId = m.id; break; }
    }
    if (!targetId) {
      throw new Error(
        `[sub-agent:${subAgentName}] Could not find message ID for user message ${userCount}.`,
      );
    }

    await conv._state.runner.editAndSendMessage(targetId, newText, opts.attachments);
    return extractResult(conv);
  }

  // ── Return bound functions ─────────────────────────────────────────────

  return {
    sendMessage,
    editConversationMessage,
  };
}

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Extract the final assistant text from a message history.
 * Returns the text of the last assistant message, or empty string.
 */
export function extractAssistantOutput(history: readonly AgentMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content) {
      return msg.content;
    }
  }
  return '';
}
