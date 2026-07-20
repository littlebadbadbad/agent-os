/**
 * Agent session — observable conversation state & execution.
 *
 * Simplified to delegate all send/edit/inject logic to a {@link ConversationRunner},
 * eliminating the duplicated agent-loop orchestration that previously lived
 * here and in {@link SubAgentRegistry}.
 *
 * @module
 */

import type { AgentMessage, ToolCall, ToolResult } from '@agent-type';
import { createHistoryTracker } from '@agent-sdk/tools/historyTracker';
import { createMessageList } from '@agent-sdk/tools/messageList';
import { createConversationRunner } from '@agent-sdk/tools/conversationRunner';
import type { EngineRefs } from '@agent-sdk/tools/conversationEngine';
import type { AgentSessionState, AgentSessionConfig, AgentSession } from './agentSession.types';
import { agentMessagesToUI } from './historyConverter';

export type { AgentSessionState, AgentSessionConfig, AgentSession } from './agentSession.types';

export function createAgentSession(config: AgentSessionConfig): AgentSession {
  const msgList = createMessageList(
    config.initialMessages ? agentMessagesToUI(config.initialMessages) : [],
  );

  let state: AgentSessionState = {
    messages: msgList.messages,
    isLoading: false,
    id: config.id,
    agentName: config.agentName,
    conversationId: config.conversationId,
    agentId: config.agentId,
    title: config.title ?? '',           // '' means no custom title yet
    subtitle: '',                        // '' means no custom subtitle yet
    updatedAt: new Date().toISOString(),
    toolStates: [],
    subAgentRegistry: null,
    enableAttachments: config.enableAttachments,
    ...config.getExternalState(),
  };
  const subscribers = new Set<() => void>();

  function setState(updater: (prev: AgentSessionState) => AgentSessionState): void {
    state = updater(state);
    for (const sub of subscribers) sub();
  }

  msgList.subscribe(() => {
    setState((prev) => ({ ...prev, messages: msgList.messages }));
  });

  config.subscribeExternalState(() => {
    setState((prev) => {
      const ext = config.getExternalState(prev);
      return Object.assign({}, prev, ext);
    });
  });

  const tracker = createHistoryTracker(config.initialMessages, config.liveHistory);
  const refs: EngineRefs = { isLoading: false, abortController: null };

  // Direct pipeline call — no UI wrapping (onPreExecutedResult in
  // conversationRunner handles tool-result UI updates).
  // Using a closure to forward the latest AbortSignal from runEngine.
  const runToolCall = (call: ToolCall): Promise<ToolResult> =>
    config.callTool(call, refs.abortController!.signal);

  const runner = createConversationRunner({
    msgList, tracker, refs,
    scope: config.scope, tsCtx: config.tsCtx,
    maxAgentTurns: config.maxAgentTurns,
    notify: (isLoading) => {
      setState((prev) => Object.assign({}, prev, { isLoading }, config.getExternalState(prev)));
    },
    invokeHandler: (msgs, signal, userText) =>
      config.getHandler(userText)(msgs, signal),
    runToolCall,
    onInterceptMessage: config.onInterceptMessage,
    toUIMessages: agentMessagesToUI,
  });

  // ── Auto-set session title from first user message ──────────────────────
  // Empty title means no custom title has been set yet — replace with the
  // actual first message text, truncating to 60 characters.
  function maybeSetTitle(text: string): void {
    if (!text || state.title) return;
    const title = text.length <= 60 ? text : text.slice(0, 57) + '…';
    session.setTitle(title);
  }

  const session: AgentSession = {
    sendMessage: async (text, attachments) => {
      maybeSetTitle(text);
      setState((prev) => ({ ...prev, updatedAt: new Date().toISOString() }));
      await runner.sendMessage(text, attachments);
    },
    editAndSendMessage: runner.editAndSendMessage,
    injectToolResult: runner.injectToolResult,

    cancelMessage(): void {
      refs.abortController?.abort();
    },

    clearHistory(): void {
      if (refs.isLoading) return;
      tracker.reset();
      msgList.truncate(0);
      config.onClearHistory();
    },

    setTitle(title: string): void {
      setState((prev) => ({ ...prev, title }));
    },

    setSubtitle(subtitle: string): void {
      setState((prev) => ({ ...prev, subtitle }));
    },

    getState(): AgentSessionState {
      return state;
    },

    subscribe(fn: () => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    getHistory(): AgentMessage[] {
      return tracker.getFullHistory();
    },

    getLiveHistory(): AgentMessage[] {
      return tracker.getLiveHistory();
    },
  };

  return session;
}
