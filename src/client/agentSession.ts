/**
 * Agent session — observable conversation state & execution.
 *
 * Simplified to delegate all send/edit/inject logic to a {@link ConversationRunner},
 * eliminating the duplicated agent-loop orchestration that previously lived
 * here and in {@link SubAgentRegistry}.
 *
 * @module
 */

import type { AgentMessage } from '@agent-type';
import { createHistoryTracker } from '@agent-sdk/tools/historyTracker';
import { createMessageList, type MessageList } from '@agent-sdk/tools/messageList';
import { createConversationRunner } from '@agent-sdk/tools/conversationRunner';
import type { EngineRefs } from '@agent-sdk/tools/conversationEngine';
import type { AgentSessionState, AgentSessionConfig, AgentSession } from './agentSession.types';
import { buildRunToolCall } from './agentSession.executors';
import { agentMessagesToUI } from './historyConverter';

export type { AgentSessionState, AgentSessionConfig, AgentSession } from './agentSession.types';


// ── Factory ───────────────────────────────────────────────────────────────────
// The factory has been substantially slimmed down.  Previously it contained an
// inline agent loop (~120 lines) with streaming hooks, batchers, onAfterTurn
// logic, and error handling — all duplicated in registryExecution.ts.  Now
// those live once in ConversationRunner, shared by both callers.

export function createAgentSession(config: AgentSessionConfig): AgentSession {
  // ── Reactive message store ────────────────────────────────────────────────
  // Single source of truth for UI messages.  Replaces the imperative
  // setMessages/setState pattern that was previously mixed into the loop.

  const msgList = createMessageList(
    config.initialMessages ? agentMessagesToUI(config.initialMessages) : [],
  );

  // ── Observable state (AgentSessionState) ────────────────────────────────
  // Built from MessageList + external ToolSet state.  Subscribers see a
  // merged snapshot that includes messages, isLoading, and every extended
  // field contributed by registered ToolSets.

  let state: AgentSessionState = {
    messages: msgList.messages,
    isLoading: false,
    id: config.id,
    agentName: config.agentName,
    conversationId: config.conversationId,
    agentId: config.agentId,
    title: config.title ?? 'New Chat',
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

  // Re-sync session state whenever the MessageList changes.
  msgList.subscribe(() => {
    setState((prev) => ({ ...prev, messages: msgList.messages }));
  });

  // Re-sync session state whenever external ToolSet contributors change.
  config.subscribeExternalState(() => {
    setState((prev) => {
      const ext = config.getExternalState(prev);
      return Object.assign({}, prev, ext);
    });
  });

  // ── Mutable runtime state ────────────────────────────────────────────────
  // isLoading and abortController are managed by runEngine inside the
  // ConversationRunner — refs is the shared bridge.

  const tracker = createHistoryTracker(config.initialMessages, config.liveHistory);
  const refs: EngineRefs = { isLoading: false, abortController: null };

  // Adapt SetMessages → MessageList.replace so buildRunToolCall works.
  const runToolCall = buildRunToolCall(
    (fn) => { msgList.replace(fn as (prev: readonly import('@agent-sdk/tools/messageList').Message[]) => import('@agent-sdk/tools/messageList').Message[]); },
    config.callTool,
    () => refs.abortController!.signal,
  );

  // ── Conversation runner ─────────────────────────────────────────────────
  // Centralises sendMessage, editAndSendMessage, and injectToolResult plus
  // the full agent loop (runEngine → runAgentLoopCore) — all streaming hooks,
  // onAfterTurn compaction, onBeforeInvoke queuing, and error handling.
  // Previously this was ~120 lines of inline code. Now it's a single call.

  const runner = createConversationRunner({
    msgList,
    tracker,
    refs,
    scope: config.scope,
    tsCtx: config.tsCtx,
    maxAgentTurns: config.maxAgentTurns,

    notify: (isLoading) => {
      setState((prev) => Object.assign({}, prev, { isLoading }, config.getExternalState(prev)));
    },

    invokeHandler: (msgs, signal, userText) =>
      config.getHandler(userText)(msgs as import('@agent-type').AgentMessage[], signal),

    runToolCall,

    onInterceptMessage: config.onInterceptMessage,
    toUIMessages: agentMessagesToUI as (msgs: import('@agent-type').AgentMessage[]) => readonly import('@agent-sdk/tools/messageList').Message[],
  });

  // ── Public API ──────────────────────────────────────────────────────────

  const session: AgentSession = {
    sendMessage: runner.sendMessage,
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

    getState(): AgentSessionState {
      return state;
    },

    subscribe(fn: () => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    getHistory(): import('@agent-type').AgentMessage[] {
      return tracker.getFullHistory();
    },

    getLiveHistory(): import('@agent-type').AgentMessage[] {
      return tracker.getLiveHistory();
    },
  };

  return session;
}
