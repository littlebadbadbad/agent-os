/**
 * Unified conversation execution runner.
 *
 * Merges the duplicated {@code sendMessage / editAndSendMessage / injectToolResult /
 * runInternalAgentLoop / runSubAgentLoop} patterns that previously lived
 * separately in {@link AgentSession} and {@link SubAgentRegistry}.
 *
 * Both callers now create a {@link ConversationRunner} with a shared
 * {@link MessageList}, {@link HistoryTracker}, and {@link ToolSetScope},
 * then delegate all conversation operations here — eliminating the
 * ~300 lines of identical orchestration that was maintained in parallel.
 *
 * @module
 */

import { createId } from '@agent-sdk/utils/shared';
import { runAgentLoopCore } from './agentLoopCore';
import { runEngine, type EngineRefs } from './conversationEngine';
import { makeBatchedAppender } from './streamingBatcher';
import { truncateAtUserMessage } from './historyUtils';
import { wrapOnBeforeInvoke } from './agentRuntime';
import type { MessageList, Message } from './messageList';
import { assistantMsg, toolMsg } from './messageList';
import type {
  AgentMessage,
  AgentTurnResponse,
  AgentStreamChunk,
  AgentRunOutcome,
  Attachment,
  CompactionResult,
  ToolCall,
  ToolResult,
  TokenUsage,
  ToolSetContext,
} from '@agent-type';
import type { ToolSetScope } from './toolSetScope';
import type { HistoryTracker } from './historyTracker';

// ── Dependencies ──────────────────────────────────────────────────────────────

export type ConversationRunnerDeps = {
  /** Reactive UI message store — replaces {@code setMessages}. */
  msgList: MessageList;
  /** Dual-buffer history tracker (live LLM context + full append-only record). */
  tracker: HistoryTracker;
  /** Engine refs (isLoading flag + abort controller) managed externally. */
  refs: EngineRefs;
  /** Unified ToolSet lifecycle orchestrator. */
  scope: ToolSetScope;
  /** Stable ToolSet context for this conversation's scope. */
  tsCtx: ToolSetContext;
  /** Maximum agentic turns per user message.  <= 0 means unlimited. */
  maxAgentTurns: number;

  /**
   * Called when isLoading changes — lets the owning session/registry
   * propagate loading-state changes to external subscribers (React, etc.).
   */
  notify: (isLoading: boolean) => void;

  /**
   * Build the per-turn handler invocation.
   *
   * Receives the current message snapshot, abort signal, and the raw user
   * message text for this turn.  The main agent uses {@code userText} to
   * rebuild its {@code HandlerContext} per-turn (for {@code onGetSystemPrompt}).
   * Sub-agent callers may ignore the parameter — they typically capture the
   * prompt and pipeline in closure before creating the runner.
   */
  invokeHandler(
    msgs: AgentMessage[],
    signal: AbortSignal,
    userText: string,
  ): Promise<AgentTurnResponse | ReadableStream<AgentStreamChunk>>;

  /**
   * Execute a single tool call with UI state updates.
   *
   * The caller wraps the raw tool-execution pipeline with UI- layer
   * bookkeeping (tool-status messages, error handling display).
   */
  runToolCall(call: ToolCall): Promise<ToolResult>;

  // ── Optional hooks ──────────────────────────────────────────────────────

  /** Intercept a message before delivery.  Return true to claim the message. */
  onInterceptMessage?(
    text: string,
    attachments: readonly Attachment[] | undefined,
    isLoading: boolean,
  ): boolean;

  /**
   * Convert raw AgentMessages to UI Messages — used when injecting queued
   * user messages into the message list during onBeforeInvoke.
   * Defaults to a simple identity-like conversion (user messages only).
   */
  toUIMessages?: (msgs: AgentMessage[]) => readonly Message[];

  /**
   * Called when `onAfterTurn` emits compaction notices.
   * Lets the caller render compaction-notice messages in the UI.
   */
  onCompactionNotices?: (notices: readonly { content: string; attachments?: readonly Attachment[] }[]) => void;
};

// ── Public API ────────────────────────────────────────────────────────────────

export type ConversationRunner = {
  /**
   * Send a user message and run the full agentic loop.
   * Returns when the loop exits (completed, max-turns, aborted, or error).
   */
  sendMessage(text: string, attachments?: readonly Attachment[]): Promise<void>;

  /**
   * Edit an existing user message (identified by UI {@code messageId}) and
   * re-send it.  Truncates the conversation at that message, pushes the new
   * text as a fresh user message, and runs the full agentic loop again.
   */
  editAndSendMessage(
    messageId: string,
    newText: string,
    attachments?: readonly Attachment[],
  ): Promise<void>;

  /**
   * Inject a synthetic tool-call + tool-result pair into the conversation
   * and start a new agent turn so the LLM can react to the result.
   *
   * Used by the user-input extension to restore tool-bound prompts after
   * session persistence reload.
   */
  injectToolResult(toolCallId: string, name: string, result: unknown): Promise<void>;

  /**
   * Diagnostic counters from the most recent loop execution.
   * `undefined` before the first run.
   */
  readonly lastRun: { readonly turns: number; readonly toolCallCount: number; readonly completed: boolean } | undefined;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createConversationRunner(deps: ConversationRunnerDeps): ConversationRunner {
  const {
    msgList, tracker, refs, scope, tsCtx, maxAgentTurns,
    notify, invokeHandler, runToolCall,
  } = deps;

  const toUI = deps.toUIMessages ?? defaultToUI;

  /** Expose the most recent loop result for callers that need turn/toolCall counts. */
  let lastRunResult: { turns: number; toolCallCount: number; completed: boolean } | undefined;

  // ── Internal agent loop ────────────────────────────────────────────────────
  //
  // This is the shared engine that both `sendMessage` and `editAndSendMessage`
  // delegate to.  It:
  //   1. Sets up the streaming batchers (text + thinking).
  //   2. Calls `runEngine` which manages isLoading + onBeforeRun / onAfterRun.
  //   3. Inside the `run` callback, delegates to `runAgentLoopCore` with
  //      streaming hooks that update the `MessageList`.
  //   4. Handles onAfterTurn (compaction + tracker advance + notices).
  //
  // Previously this logic was duplicated as `runInternalAgentLoop` in
  // agentSession.ts (~120 lines) and `runSubAgentLoop` in registryExecution.ts
  // (~80 lines).  Now it lives here — once.

  async function runConversationLoop(userText: string): Promise<void> {
    tracker.setTurnStart(tracker.getLiveHistory().length);

    // ── Per-turn streaming state ─────────────────────────────────────────
    const turnRef = { assistantId: createId(), followUpId: '' };
    msgList.push(assistantMsg(turnRef.assistantId, '', true));

    // ── Batched appenders ───────────────────────────────────────────────
    const mainContent = makeBatchedAppender((delta) => {
      const id = turnRef.followUpId || turnRef.assistantId;
      msgList.update(id, (m) => m ? { ...m, content: (m.content ?? '') + delta } : m);
    });
    const mainThinking = makeBatchedAppender((delta) => {
      msgList.update(turnRef.assistantId, (m) => m ? { ...m, thinking: (m.thinking ?? '') + delta } : m);
    });

    // ── onAfterTurn — compaction + notices ──────────────────────────────
    async function handleAfterTurn(
      historySnapshot: AgentMessage[],
      usage: TokenUsage | undefined,
      signal: AbortSignal,
    ): Promise<AgentMessage[] | void> {
      const result = await scope.composeAfterTurn(historySnapshot, tsCtx, usage, signal);
      if (result.changed || result.notices.length > 0) {
        tracker.advanceTurn([...result.history]);
        for (const notice of result.notices) {
          msgList.push({ ...assistantMsg(createId(), notice.content), attachments: notice.attachments });
          deps.onCompactionNotices?.([notice]);
        }
        return result.history;
      }
      tracker.advanceTurn([...historySnapshot]);
    }

    // ── Delegate to the unified engine ──────────────────────────────────
    await runEngine(
      refs,
      {
        onBeforeRun: () => scope.beforeRun(tsCtx, tracker.getLiveHistory()),
        onAfterRun: (outcome) => scope.afterRun(tsCtx, outcome),
      },
      async (signal) => {
        let outcome: AgentRunOutcome = 'error';

        try {
          const loopResult = await runAgentLoopCore({
            initialHistory: tracker.getLiveHistory(),
            maxTurns: maxAgentTurns <= 0 ? Infinity : maxAgentTurns,
            signal,
            invokeHandler: (msgs, sig) =>
              deps.invokeHandler(msgs as AgentMessage[], sig, userText),
            callTool: (call) => runToolCall(call),
            hooks: {
              onTurnBegin(turn) {
                if (turn > 0) {
                  mainContent.flush();
                  mainThinking.flush();
                  turnRef.followUpId = '';
                  turnRef.assistantId = createId();
                  msgList.push(assistantMsg(turnRef.assistantId, '', true));
                }
              },

              onAssistantText(text, thinking) {
                msgList.update(turnRef.assistantId, (m) =>
                  m ? { ...assistantMsg(turnRef.assistantId, text), thinking: thinking ?? undefined } : m,
                );
              },

              onStreamEnd() {
                mainContent.flush();
                mainThinking.flush();
              },

              onTextDelta(delta, hasSeenTool) {
                if (!hasSeenTool) {
                  mainContent.append(delta);
                } else {
                  if (!turnRef.followUpId) {
                    mainContent.flush();
                    turnRef.followUpId = createId();
                    msgList.push(assistantMsg(turnRef.followUpId, delta, true));
                  } else {
                    mainContent.append(delta);
                  }
                }
              },

              onThinkingDelta(delta, hasSeenTool) {
                if (!hasSeenTool) mainThinking.append(delta);
              },

              onFirstToolSeen() {
                mainContent.flush();
                mainThinking.flush();
                msgList.update(turnRef.assistantId, (m) =>
                  m ? { ...m, isStreaming: false } : m,
                );
              },

              onPreExecutedResult(call, res) {
                msgList.push(toolMsg({
                  toolCallId: call.id,
                  name: call.name,
                  arguments: call.arguments,
                  status: 'done',
                  result: res.result,
                }));
              },

              onAttachment(attachment) {
                const targetId = turnRef.followUpId || turnRef.assistantId;
                msgList.update(targetId, (m) =>
                  m ? { ...m, attachments: [...(m.attachments ?? []), attachment] } : m,
                );
              },

              onBeforeInvoke: wrapOnBeforeInvoke(
                () => scope.beforeInvoke(tsCtx),
                tracker,
                (injected) => {
                  const uiMsgs = toUI(injected.filter((m) => m.role === 'user'));
                  if (uiMsgs.length > 0) {
                    // Insert queued user messages just before the last streaming
                    // message (or at the end if none is streaming).
                    const idx = msgList.lastStreamingIndex();
                    msgList.replace((prev) => {
                      const newMsgs = uiMsgs as Message[];
                      return idx === -1
                        ? [...prev, ...newMsgs]
                        : [...prev.slice(0, idx), ...newMsgs, ...prev.slice(idx)];
                    });
                  }
                },
              ),

              onAfterTurn: handleAfterTurn,
            },
          });

          lastRunResult = {
            turns: loopResult.turns,
            toolCallCount: loopResult.toolCallCount,
            completed: loopResult.completed,
          };

          tracker.advanceTurn(loopResult.history);

          outcome = signal.aborted
            ? 'aborted'
            : loopResult.completed ? 'completed' : 'max-turns';

          // Turn off streaming flag on the primary assistant message.
          msgList.update(turnRef.assistantId, (m) =>
            m?.isStreaming ? { ...m, isStreaming: false } : m,
          );

          if (!loopResult.completed && !signal.aborted) {
            msgList.push(assistantMsg(createId(), '_Reached the maximum number of agent turns. Please follow up to continue._'));
          }
        } catch (err) {
          const isAbort = err instanceof Error && err.name === 'AbortError';
          outcome = isAbort ? 'aborted' : 'error';
          msgList.update(turnRef.assistantId, (m) =>
            m
              ? {
                  ...m,
                  content: isAbort ? m.content : m.content.trim() || 'An error occurred. Please try again.',
                  isStreaming: false,
                }
              : m,
          );
        }

        return { outcome };
      },
      () => notify(refs.isLoading),
    );
  }

  // ── sendMessage ────────────────────────────────────────────────────────────

  async function sendMessage(
    text: string,
    attachments?: readonly Attachment[],
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    // ToolSet intercept check — plugins can queue the message while the agent
    // is busy (e.g. pending-input plugin).  Runs BEFORE the isLoading guard so
    // programmatic sends from tools (e.g. send_async_message) also hit it.
    if (deps.onInterceptMessage?.(text, attachments, refs.isLoading)) return;
    if (refs.isLoading) return;

    const userMsg: AgentMessage = attachments?.length
      ? { role: 'user', content: trimmed, attachments }
      : { role: 'user', content: trimmed };

    msgList.push({ id: createId(), role: 'user', content: trimmed, isStreaming: false, attachments });
    tracker.pushToBoth(userMsg);

    await runConversationLoop(trimmed);
  }

  // ── editAndSendMessage ─────────────────────────────────────────────────────

  async function editAndSendMessage(
    messageId: string,
    newText: string,
    attachments?: readonly Attachment[],
  ): Promise<void> {
    const trimmed = newText.trim();
    if (!trimmed) return;
    if (refs.isLoading) return;

    // Find the user message in the UI message list.
    const msgIndex = msgList.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    // Count how many user messages appear up to (and including) this index.
    let userCount = 0;
    const msgs = msgList.messages;
    for (let i = 0; i <= msgIndex; i++) {
      if (msgs[i].role === 'user') userCount++;
    }

    // Use fullHistory (never compacted) as the truth source for finding the Nth
    // real user message — compacted history may contain synthetic user messages
    // (e.g. SUMMARY_ANCHOR_PREFIX) that are invisible in the UI.
    const truncResult = truncateAtUserMessage(tracker.getFullHistory(), userCount);
    if (truncResult.userIndex === -1) return;

    // Destructively truncate the old branch from both histories.
    tracker.replaceBoth(truncResult.history, truncResult.fullHistory);

    // Truncate UI messages at the edit point.
    msgList.truncate(msgIndex);

    // Add the new user message to both histories and UI.
    const newUserMsg: AgentMessage = attachments?.length
      ? { role: 'user', content: trimmed, attachments }
      : { role: 'user', content: trimmed };
    tracker.pushToBoth(newUserMsg);
    msgList.push({ id: createId(), role: 'user', content: trimmed, isStreaming: false, attachments });

    await runConversationLoop(trimmed);
  }

  // ── injectToolResult ──────────────────────────────────────────────────────

  async function injectToolResult(
    toolCallId: string,
    name: string,
    result: unknown,
  ): Promise<void> {
    if (refs.isLoading) return;

    const hasExistingToolCall = tracker.getLiveHistory().some(
      (m) => m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === toolCallId),
    );

    // Push assistant first (if needed), then tool result to tracker.
    if (!hasExistingToolCall) {
      tracker.pushToBoth({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: toolCallId, name, arguments: {} }],
      } satisfies AgentMessage);
    }
    tracker.pushToBoth({
      role: 'tool',
      toolCallId,
      name,
      content: result,
    } satisfies AgentMessage);

    // Batch UI updates.
    const additions: Message[] = [
      toolMsg({ toolCallId, name, arguments: {}, status: 'done', result }),
    ];
    if (!hasExistingToolCall) {
      additions.unshift({ id: createId(), role: 'assistant', content: '', isStreaming: false });
    }
    msgList.push(...additions);

    // Start the agent loop with an empty user message — the LLM sees the
    // tool result and generates a response grounded on it.
    await runConversationLoop('');
  }

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    sendMessage,
    editAndSendMessage,
    injectToolResult,
    get lastRun() { return lastRunResult; },
  };
}

// ── Default UI converter ─────────────────────────────────────────────────────

function defaultToUI(msgs: AgentMessage[]): readonly Message[] {
  return msgs
    .filter((m) => m.role === 'user')
    .map((m) => ({
      id: createId(),
      role: 'user' as const,
      content: typeof m.content === 'string' ? m.content : '',
      isStreaming: false,
      attachments: m.attachments,
    }));
}
