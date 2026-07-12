import type { AgentMessage, Attachment, TokenUsage, ToolResult } from '@agent-type';
import { runAgentLoopCore } from '@agent-sdk/tools/agentLoopCore';
import { truncateAtUserMessage } from '@agent-sdk/tools/historyUtils';
import { createHistoryTracker } from '@agent-sdk/tools/historyTracker';
import { wrapOnBeforeInvoke } from '@agent-sdk/tools/agentRuntime';
import { createId, assistantMsg, toolMsg } from '../../agent-UI/components/AgentWidget/helpers';
import type { AgentSessionState, AgentSessionConfig, AgentSession } from './agentSession.types';
import type { AgentRunOutcome } from '@agent-type';
import { buildRunToolCall, makeBatchedAppender, type SetMessages } from './agentSession.executors';
import { agentMessagesToUI } from './historyConverter';

export type { AgentSessionState, AgentSessionConfig, AgentSession } from './agentSession.types';


// ── Factory ───────────────────────────────────────────────────────────────────

export function createAgentSession(config: AgentSessionConfig): AgentSession {
  // ── Observable state ──────────────────────────────────────────────────────

  let state: AgentSessionState = {
    messages: config.initialMessages ? agentMessagesToUI(config.initialMessages) : [],
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

  const setMessages: SetMessages = (updater) => {
    setState((prev) => ({ ...prev, messages: updater(prev.messages) }));
  };

  // ── Subscribe to external state slices ───────────────────────────────────
  // Each subscription merges that slice's latest snapshot into session state.
  // Subscriptions live as long as the session — no cleanup needed.

  config.subscribeExternalState(() => {
    setState((prev) => {
      const ext = config.getExternalState(prev);
      return Object.assign({}, prev, ext);
    });
  });

  // ── Mutable runtime state (not observable) ────────────────────────────────

  const tracker = createHistoryTracker(config.initialMessages, config.liveHistory);
  let isLoadingFlag = false;
  let abortController: AbortController | null = null;

  // ── Tool execution ────────────────────────────────────────────────────────

  const runToolCall = buildRunToolCall(setMessages, config.callTool, () => abortController!.signal);


  // ── Shared agent loop runner ──────────────────────────────────────────────
  //
  // Both `sendMessage` and `editAndSendMessage` set up a user message first,
  // then delegate to this function to run the actual agentic loop + streaming.

  async function runInternalAgentLoop(
    userText: string,
    userMsg: AgentMessage,
  ): Promise<void> {
    config.onBeforeRun?.(tracker.getLiveHistory());

    tracker.setTurnStart(tracker.getLiveHistory().length);

    // Per-turn streaming state. Captured as a mutable object so the batched
    // appenders (created once) can pick up updates via their closure.
    const turnRef = { assistantId: createId(), followUpId: '' };
    setMessages((prev) => [...prev, assistantMsg(turnRef.assistantId, '', true)]);

    // Batched appenders — accumulate streaming deltas and flush once per
    // animation frame to avoid a React re-render for every character.
    const mainContent  = makeBatchedAppender(() => turnRef.followUpId || turnRef.assistantId, 'content',  setMessages);
    const mainThinking = makeBatchedAppender(() => turnRef.assistantId,                        'thinking', setMessages);

    // onAfterTurn: delegate to ToolSet hooks composed by the agent client.
    // If a compaction occurred, inject any ToolSet-provided UI notices and
    // return the new history so the core loop replaces its internal copy.
    async function onAfterTurn(
      historySnapshot: AgentMessage[],
      usage: TokenUsage | undefined,
      signal: AbortSignal,
    ): Promise<AgentMessage[] | void> {
      const result = await config.onAfterTurn?.(historySnapshot, usage, signal);
      if (result) {
        tracker.advanceTurn([...result.history]);
        for (const notice of result.notices ?? []) {
          setMessages((prev) => [
            ...prev,
            { ...assistantMsg(createId(), notice.content), attachments: notice.attachments },
          ]);
        }
        return result.history;
      }
      tracker.advanceTurn([...historySnapshot]);
    }

    isLoadingFlag = true;
    setState((prev) => ({ ...prev, isLoading: true }));

    const controller = new AbortController();
    abortController = controller;

    let outcome: AgentRunOutcome = 'error';

    try {
      const loopResult = await runAgentLoopCore({
        initialHistory: tracker.getLiveHistory(),
        maxTurns: config.maxAgentTurns <= 0 ? Infinity : config.maxAgentTurns,
        signal: controller.signal,
        invokeHandler: (msgs, sig) =>
          config.getHandler(userText)(msgs as AgentMessage[], sig),
        callTool: (call) => runToolCall(call),
        hooks: {
          onTurnBegin(turn) {
            if (turn > 0) {
              // Flush any buffered content from the previous streaming turn,
              // then create a fresh streaming placeholder for the next LLM call.
              mainContent.flush();
              mainThinking.flush();
              turnRef.followUpId = '';
              turnRef.assistantId = createId();
              setMessages((prev) => [...prev, assistantMsg(turnRef.assistantId, '', true)]);
            }
          },
          onAssistantText(text, thinking) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === turnRef.assistantId
                  ? { ...assistantMsg(turnRef.assistantId, text), thinking: thinking ?? undefined }
                  : m,
              ),
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
                // First post-tool text: flush the pre-tool bubble and open a new one.
                mainContent.flush();
                turnRef.followUpId = createId();
                setMessages((prev) => [...prev, assistantMsg(turnRef.followUpId, delta, true)]);
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
            setMessages((prev) =>
              prev.map((m) => (m.id === turnRef.assistantId ? { ...m, isStreaming: false } : m)),
            );
          },
          onPreExecutedResult(call, res) {
            setMessages((prev) => [
              ...prev,
              toolMsg({ toolCallId: call.id, name: call.name, arguments: call.arguments, status: 'done', result: res.result }),
            ]);
          },
          onAttachment(attachment) {
            const targetId = turnRef.followUpId || turnRef.assistantId;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? { ...m, attachments: [...(m.attachments ?? []), attachment] }
                  : m,
              ),
            );
          },
          onBeforeInvoke: wrapOnBeforeInvoke(
            () => config.onBeforeInvoke?.() ?? [],
            tracker,
            (injected) => {
              console.log('[onBeforeInvoke] injected.length =', injected.length, injected.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 40) : '[non-string]' })));
              const uiMsgs = agentMessagesToUI(injected.filter((m) => m.role === 'user'));
              console.log('[onBeforeInvoke] uiMsgs.length =', uiMsgs.length, uiMsgs.map(m => ({ role: m.role, content: m.content.slice(0, 40) })));
              if (uiMsgs.length > 0) {
                // Single atomic setState: insert injected messages into the chat
                // AND refresh all external state (clearing pendingInputMessages)
                // in one update so React never observes an intermediate snapshot
                // where the pending strip is already empty but the messages have
                // not yet appeared in the chat.
                setState((prev) => {
                  const lastStreamingIdx = prev.messages.reduceRight<number>(
                    (found, m, i) => (found === -1 && m.isStreaming ? i : found),
                    -1,
                  );
                  const newMessages =
                    lastStreamingIdx === -1
                      ? [...prev.messages, ...uiMsgs]
                      : [...prev.messages.slice(0, lastStreamingIdx), ...uiMsgs, ...prev.messages.slice(lastStreamingIdx)];
                  console.log('[onBeforeInvoke] setState: prev.messages.length =', prev.messages.length, '| newMessages.length =', newMessages.length, '| lastStreamingIdx =', lastStreamingIdx, '| newMessages roles =', newMessages.map(m => m.role + (m.isStreaming ? '(streaming)' : '')));
                  return { ...prev, messages: newMessages, ...config.getExternalState(prev) };
                });
              }
            },
          ),
          onAfterTurn: onAfterTurn,
        },
      });

      tracker.advanceTurn(loopResult.history);

      outcome = controller.signal.aborted
        ? 'aborted'
        : loopResult.completed ? 'completed' : 'max-turns';

      setMessages((prev) =>
        prev.map((m) =>
          m.id === turnRef.assistantId && m.isStreaming ? { ...m, isStreaming: false } : m,
        ),
      );

      if (!loopResult.completed && !controller.signal.aborted) {
        setMessages((prev) => [
          ...prev,
          assistantMsg(createId(), '_Reached the maximum number of agent turns. Please follow up to continue._'),
        ]);
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      outcome = isAbort ? 'aborted' : 'error';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === turnRef.assistantId
            ? {
                ...m,
                content: isAbort ? m.content : m.content.trim() || 'An error occurred. Please try again.',
                isStreaming: false,
              }
            : m,
        ),
      );
    } finally {
      abortController = null;
      isLoadingFlag = false;
      setState((prev) => ({ ...prev, isLoading: false }));
      // Fire post-run hooks. Implementations (e.g. PendingInputToolSet) may
      // call sendMessage synchronously here — isLoadingFlag is already false
      // so the call goes through immediately and starts the next run.
      config.onAfterRun?.(outcome);
    }
  }


  // ── sendMessage ───────────────────────────────────────────────────────────
  // Creates a user message from scratch and runs the agent loop.

  async function sendMessage(
    text: string,
    attachments?: readonly Attachment[],
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;
    // ToolSet intercept check — plugins can queue the message while the agent
    // is busy (e.g. pending-input plugin). Runs BEFORE the isLoading guard so
    // that programmatic sends from tools (e.g. send_async_message) also hit
    // the interceptor.
    if (config.onInterceptMessage?.(text, attachments, isLoadingFlag)) return;
    if (isLoadingFlag) return;

    setMessages((prev) => [
      ...prev,
      { id: createId(), role: 'user', content: trimmed, isStreaming: false, attachments },
    ]);
    const userMsg: AgentMessage =
      attachments && attachments.length > 0
        ? { role: 'user', content: trimmed, attachments }
        : { role: 'user', content: trimmed };
    tracker.pushToBoth(userMsg);

    await runInternalAgentLoop(trimmed, userMsg);
  }


  // ── editAndSendMessage ────────────────────────────────────────────────────
  // Finds an existing user message by UI messageId, truncates history at that
  // point, replaces it with new text, and re-runs the agent loop.

  async function editAndSendMessage(
    messageId: string,
    newText: string,
    attachments?: readonly Attachment[],
  ): Promise<void> {
    const trimmed = newText.trim();
    if (!trimmed) return;
    if (isLoadingFlag) return;

    // Find the user message in the UI message list
    const msgIndex = state.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    // Count how many user messages appear up to (and including) this index
    let userCount = 0;
    for (let i = 0; i <= msgIndex; i++) {
      if (state.messages[i].role === 'user') userCount++;
    }

    // Use fullHistory (never compacted) as the truth source for finding the Nth
    // real user message. history (LLM context) may contain SUMMARY_ANCHOR_PREFIX
    // user messages after compaction that are invisible in the UI, causing count
    // misalignment if used as the basis for truncation.
    const truncResult = truncateAtUserMessage(tracker.getFullHistory(), userCount);
    if (truncResult.userIndex === -1) return;

    // Destructively truncate the old branch from both histories.
    tracker.replaceBoth(truncResult.history, truncResult.fullHistory);

    // Truncate UI messages at the edit point.
    setMessages((prev) => prev.slice(0, msgIndex));

    // Add the new user message to both histories and UI.
    const newUserMsg: AgentMessage =
      attachments && attachments.length > 0
        ? { role: 'user', content: trimmed, attachments }
        : { role: 'user', content: trimmed };
    tracker.pushToBoth(newUserMsg);
    setMessages((prev) => [
      ...prev,
      { id: createId(), role: 'user', content: trimmed, isStreaming: false, attachments },
    ]);

    // Run the agent loop — identical lifecycle to sendMessage.
    await runInternalAgentLoop(trimmed, newUserMsg);
  }


  // ── cancelMessage ─────────────────────────────────────────────────────────

  function cancelMessage(): void {
    abortController?.abort();
  }


  // ── clearHistory ──────────────────────────────────────────────────────────

  function clearHistory(): void {
    setMessages(() => []);
    tracker.reset();
    config.onClearHistory();
  }


  // ── Session interface ─────────────────────────────────────────────────────

  function getState(): AgentSessionState {
    return state;
  }

  function subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }

  return {
    sendMessage,
    editAndSendMessage,
    cancelMessage,
    clearHistory,
    getState,
    subscribe,
    getHistory(): AgentMessage[] { return tracker.getFullHistory(); },
    getLiveHistory(): AgentMessage[] { return tracker.getLiveHistory(); },
    setTitle(title: string): void { setState((prev) => ({ ...prev, title })); },
  };
}
