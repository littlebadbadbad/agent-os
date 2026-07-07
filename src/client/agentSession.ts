import type { AgentMessage, Attachment, TokenUsage, ToolResult } from '@agent-type';
import { runAgentLoopCore } from '@agent-sdk/tools/agentLoopCore';
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
    subAgentRegistries: [],
    terminalAdapter: undefined,
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

  // `history` is the compacted LLM context fed to the model on every API call.
  // On session restore it starts as `liveHistory` (if saved) so that a long
  // fullHistory does not immediately overflow the model's context window.
  let history: AgentMessage[] = config.liveHistory
    ? [...config.liveHistory]
    : config.initialMessages
      ? [...config.initialMessages]
      : [];
  // fullHistory is the append-only record of every message in the conversation.
  // Unlike `history` (the LLM context), it is never replaced by a compacted
  // summary — it grows monotonically so that persistence always saves the
  // complete conversation rather than just the compacted LLM context window.
  let fullHistory: AgentMessage[] = config.initialMessages ? [...config.initialMessages] : [];
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
    config.onBeforeRun?.(history);

    // Tracks the slice boundary for incrementally appending to fullHistory.
    // After each turn (or compaction) this advances to the new end of the LLM
    // context so we only push the *new* messages from that turn.
    let nextTurnStart = history.length;

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
      // Append any messages added this turn to the full (non-compacted) record.
      fullHistory.push(...historySnapshot.slice(nextTurnStart));

      // Keep the live history reference current after every turn so that
      // getLiveHistory() (and therefore flushPersistence / snapshot saves) always
      // reflects the latest LLM context — not just the stale snapshot from when
      // sendMessage was first called.  Without this, tools like upgrade_restart
      // that call flushPersistence() mid-loop would save a history that only
      // contains the initial user message.
      history = [...historySnapshot];

      const result = await config.onAfterTurn?.(historySnapshot, usage, signal);
      if (result) {
        // Advance the boundary to the compacted context length so the next
        // turn only slices the genuinely new messages.
        nextTurnStart = result.history.length;
        history = [...result.history];
        for (const notice of result.notices ?? []) {
          setMessages((prev) => [
            ...prev,
            { ...assistantMsg(createId(), notice.content), attachments: notice.attachments },
          ]);
        }
        return result.history;
      }
      // No compaction — advance boundary to the current snapshot length.
      nextTurnStart = historySnapshot.length;
    }

    isLoadingFlag = true;
    setState((prev) => ({ ...prev, isLoading: true }));

    const controller = new AbortController();
    abortController = controller;

    let outcome: AgentRunOutcome = 'error';

    try {
      const loopResult = await runAgentLoopCore({
        initialHistory: [...history],
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
          onBeforeInvoke: () => {
            const injected = config.onBeforeInvoke?.() ?? [];
            console.log('[onBeforeInvoke] injected.length =', injected.length, injected.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 40) : '[non-string]' })));
            if (injected.length > 0) {
              // Immediately commit injected messages to fullHistory so that any
              // debounced snapshot save that fires before onAfterTurn still
              // captures them — closes the persistence gap that would otherwise
              // lose queued messages on a page reload.
              fullHistory.push(...injected);
              nextTurnStart += injected.length;

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
            }
            return injected;
          },
          onAfterTurn: onAfterTurn,
        },
      });

      history = loopResult.history;

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
    if (isLoadingFlag) return;

    setMessages((prev) => [
      ...prev,
      { id: createId(), role: 'user', content: trimmed, isStreaming: false, attachments },
    ]);
    const userMsg: AgentMessage =
      attachments && attachments.length > 0
        ? { role: 'user', content: trimmed, attachments }
        : { role: 'user', content: trimmed };
    history.push(userMsg);
    fullHistory.push(userMsg);

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
    let fhUserIdx = -1;
    let fhUserFound = 0;
    for (let i = 0; i < fullHistory.length; i++) {
      if (fullHistory[i].role === 'user') {
        fhUserFound++;
        if (fhUserFound === userCount) {
          fhUserIdx = i;
          break;
        }
      }
    }
    if (fhUserIdx === -1) return;

    // Destructively truncate the old branch from both histories.
    fullHistory = fullHistory.slice(0, fhUserIdx);
    // Resync LLM context from fullHistory — this also drops any stale compaction
    // anchors that are no longer valid after the branch is discarded.
    history = [...fullHistory];

    // Truncate UI messages at the edit point.
    setMessages((prev) => prev.slice(0, msgIndex));

    // Add the new user message to all three: fullHistory, history, and UI.
    const newUserMsg: AgentMessage =
      attachments && attachments.length > 0
        ? { role: 'user', content: trimmed, attachments }
        : { role: 'user', content: trimmed };
    fullHistory.push(newUserMsg);
    history.push(newUserMsg);
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
    history = [];
    fullHistory = [];
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
    getHistory(): AgentMessage[] { return [...fullHistory]; },
    getLiveHistory(): AgentMessage[] { return [...history]; },
    setTitle(title: string): void { setState((prev) => ({ ...prev, title })); },
  };
}
