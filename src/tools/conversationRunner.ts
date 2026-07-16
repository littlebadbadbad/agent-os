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
  ToolCall,
  ToolResult,
  TokenUsage,
  ToolSetContext,
} from '@agent-type';
import type { ToolSetScope } from './toolSetScope';
import type { HistoryTracker } from './historyTracker';

// ── Dependencies ──────────────────────────────────────────────────────────────

export type ConversationRunnerDeps = {
  msgList: MessageList;
  tracker: HistoryTracker;
  refs: EngineRefs;
  scope: ToolSetScope;
  tsCtx: ToolSetContext;
  maxAgentTurns: number;
  notify: (isLoading: boolean) => void;
  invokeHandler(
    msgs: AgentMessage[],
    signal: AbortSignal,
    userText: string,
  ): Promise<AgentTurnResponse | ReadableStream<AgentStreamChunk>>;
  runToolCall(call: ToolCall): Promise<ToolResult>;
  onInterceptMessage?(
    text: string,
    attachments: readonly Attachment[] | undefined,
    isLoading: boolean,
  ): boolean;
  toUIMessages?: (msgs: AgentMessage[]) => readonly Message[];
  onCompactionNotices?: (notices: readonly { content: string; attachments?: readonly Attachment[] }[]) => void;
};

// ── Public API ────────────────────────────────────────────────────────────────

export type ConversationRunner = {
  sendMessage(text: string, attachments?: readonly Attachment[]): Promise<void>;
  editAndSendMessage(messageId: string, newText: string, attachments?: readonly Attachment[]): Promise<void>;
  injectToolResult(toolCallId: string, name: string, result: unknown): Promise<void>;
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

  async function runConversationLoop(userText: string): Promise<void> {
    tracker.setTurnStart(tracker.getLiveHistory().length);
    const turnRef = { assistantId: createId(), followUpId: '' };
    msgList.push(assistantMsg(turnRef.assistantId, '', true));
    const mainContent = makeBatchedAppender((delta) => {
      const id = turnRef.followUpId || turnRef.assistantId;
      msgList.update(id, (m) => m ? { ...m, content: (m.content ?? '') + delta } : m);
    });
    const mainThinking = makeBatchedAppender((delta) => {
      msgList.update(turnRef.assistantId, (m) => m ? { ...m, thinking: (m.thinking ?? '') + delta } : m);
    });

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
              onTurnSnapshot: (history) => {
                const turnStart = tracker.getTurnStart();
                if (turnStart >= history.length) return;
                tracker.advanceTurn(history);
              },

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

              onBeforeToolCalls(calls) {
                for (const call of calls) {
                  msgList.push(toolMsg({
                    toolCallId: call.id,
                    name: call.name,
                    arguments: call.arguments,
                    status: 'running',
                  }));
                }
              },

              onAfterToolCall(call, result) {
                const isError = typeof result.result === 'string' && result.result.startsWith('Error: ');
                const exists = msgList.messages.some((m) => m.id === call.id);
                if (exists) {
                  msgList.update(call.id, (m) =>
                    m?.toolCall
                      ? {
                          ...m,
                          toolCall: {
                            ...m.toolCall,
                            status: isError ? 'error' : 'done',
                            ...(isError ? { error: result.result as string } : { result: result.result }),
                            ...(result.attachments?.length ? { attachments: [...result.attachments] } : {}),
                          },
                        }
                      : m,
                  );
                } else {
                  // Streaming path: no beforeToolCalls ran, create card now.
                  msgList.push(toolMsg({
                    toolCallId: call.id,
                    name: call.name,
                    arguments: call.arguments,
                    status: isError ? 'error' : 'done',
                    ...(isError ? { error: result.result as string } : { result: result.result }),
                    ...(result.attachments?.length ? { attachments: [...result.attachments] } : {}),
                  }));
                }
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

  async function injectToolResult(toolCallId: string, name: string, result: unknown): Promise<void> {
    if (refs.isLoading) return;

    const live = tracker.getLiveHistory();

    // When a session snapshot is restored with a pending ask_user prompt, the
    // HistoryTracker constructor seals the orphaned tool call by inserting a
    // synthetic `{cancelled:true}` tool result.  When the user later answers,
    // we must REPLACE that synthetic result with the real answer rather than
    // appending a duplicate (which causes API 400 errors).
    const CANCELLED_PAYLOAD = JSON.stringify({ cancelled: true });
    const existingResult = live.find(
      (m) => m.role === 'tool' && m.toolCallId === toolCallId && m.content === CANCELLED_PAYLOAD,
    );
    if (existingResult) {
      tracker.replaceToolResult(toolCallId, result);
      const existing = msgList.messages.some((m) => m.id === toolCallId);
      if (existing) {
        msgList.update(toolCallId, (m) =>
          m?.toolCall ? { ...m, toolCall: { ...m.toolCall, result } } : m,
        );
      } else {
        msgList.push(toolMsg({ toolCallId, name, arguments: {}, status: 'done', result }));
      }
      await runConversationLoop('');
      return;
    }

    const hasExistingToolCall = live.some(
      (m) => m.role === 'assistant' && m.toolCalls?.some(
        (tc) => tc.id === toolCallId || (tc.name === name && !live.some((t) => t.role === 'tool' && t.toolCallId === tc.id)),
      ),
    );

    if (!hasExistingToolCall) {
      tracker.pushToBoth({ role: 'assistant', content: '', toolCalls: [{ id: toolCallId, name, arguments: {} }] } satisfies AgentMessage);
    }
    tracker.pushToBoth({ role: 'tool', toolCallId, name, content: result } satisfies AgentMessage);

    const additions: Message[] = [toolMsg({ toolCallId, name, arguments: {}, status: 'done', result })];
    if (!hasExistingToolCall) {
      additions.unshift({ id: createId(), role: 'assistant', content: '', isStreaming: false });
    }
    msgList.push(...additions);

    await runConversationLoop('');
  }

  async function sendMessage(text: string, attachments?: readonly Attachment[]): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;
    if (deps.onInterceptMessage?.(text, attachments, refs.isLoading)) return;
    if (refs.isLoading) return;

    const userMsg: AgentMessage = attachments?.length
      ? { role: 'user', content: trimmed, attachments }
      : { role: 'user', content: trimmed };

    msgList.push({ id: createId(), role: 'user', content: trimmed, isStreaming: false, attachments });
    tracker.pushToBoth(userMsg);
    await runConversationLoop(trimmed);
  }

  async function editAndSendMessage(messageId: string, newText: string, attachments?: readonly Attachment[]): Promise<void> {
    const trimmed = newText.trim();
    if (!trimmed) return;
    if (refs.isLoading) return;

    const msgIndex = msgList.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    let userCount = 0;
    for (let i = 0; i <= msgIndex; i++) {
      if (msgList.messages[i].role === 'user') userCount++;
    }

    const truncResult = truncateAtUserMessage(tracker.getFullHistory(), userCount);
    if (truncResult.userIndex === -1) return;

    tracker.replaceBoth(truncResult.history, truncResult.fullHistory);
    msgList.truncate(msgIndex);

    const newUserMsg: AgentMessage = attachments?.length
      ? { role: 'user', content: trimmed, attachments }
      : { role: 'user', content: trimmed };
    tracker.pushToBoth(newUserMsg);
    msgList.push({ id: createId(), role: 'user', content: trimmed, isStreaming: false, attachments });
    await runConversationLoop(trimmed);
  }

  return {
    sendMessage,
    editAndSendMessage,
    injectToolResult,
    get lastRun() { return lastRunResult; },
  };
}

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
