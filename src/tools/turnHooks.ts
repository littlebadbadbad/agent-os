/**
 * Turn Hooks Factory — builds the `AgentLoopHooks` object for `runAgentLoopCore`.
 *
 * Extracted from `conversationRunner.ts` to eliminate the 80-line inline hooks
 * object that duplicated the same UI-update logic across multiple call sites.
 *
 * The factory accepts the mutable UI references (message list, batched appenders,
 * turn refs) and produces a complete hooks object that bridges the pure agent
 * loop with the UI layer.
 */

import { createId } from '@agent-sdk/utils/shared';
import type { AgentLoopHooks } from './agentLoopCore';
import type { MessageList, Message } from './messageList';
import { assistantMsg, toolMsg } from './messageList';
import { wrapOnBeforeInvoke } from './agentRuntime';
import type { TextAppender } from './streamingBatcher';
import type { ToolSetScope } from './toolSetScope';
import type { HistoryTracker } from './historyTracker';
import type {
  AgentMessage,
  ToolCall,
  ToolResult,
  Attachment,
  TokenUsage,
  ToolSetContext,
} from '@agent-type';

// ── Mutable references managed across turns ───────────────────────────────────

export type TurnRefs = {
  /** ID of the primary assistant message (first turn) or current-turn assistant. */
  assistantId: string;
  /** ID of the follow-up assistant message (post-tool text in streaming path). */
  followUpId: string;
};

// ── Dependencies ──────────────────────────────────────────────────────────────

export type TurnHookDeps = {
  turnRef: TurnRefs;
  msgList: MessageList;
  mainContent: TextAppender;
  mainThinking: TextAppender;
  scope: ToolSetScope;
  tsCtx: ToolSetContext;
  tracker: HistoryTracker;
  /** Optional callback for compaction notices emitted by ToolSets. */
  onCompactionNotices?: (notices: readonly { content: string; attachments?: readonly Attachment[] }[]) => void;
  /** Optional UI message converter. */
  toUIMessages?: (msgs: AgentMessage[]) => readonly Message[];
  /** Called after each complete turn to advance the tracker. */
  onAdvanceTurn?(history: AgentMessage[]): void;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTurnHooks(deps: TurnHookDeps): AgentLoopHooks {
  const { turnRef, msgList, mainContent, mainThinking, scope, tsCtx, tracker, onCompactionNotices } = deps;
  const toUI = deps.toUIMessages ?? defaultToUI;

  return {

    onTurnBegin(turn): void {
      if (turn > 0) {
        mainContent.flush();
        mainThinking.flush();
        turnRef.followUpId = '';
        turnRef.assistantId = createId();
        msgList.push(assistantMsg(turnRef.assistantId, '', true));
      }
    },

    onAssistantText(text, thinking): void {
      msgList.update(turnRef.assistantId, (m) =>
        m ? { ...assistantMsg(turnRef.assistantId, text), thinking: thinking ?? undefined } : m,
      );
    },

    onStreamEnd(): void {
      mainContent.flush();
      mainThinking.flush();
    },

    onTextDelta(delta, hasSeenTool): void {
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

    onThinkingDelta(delta, hasSeenTool): void {
      if (!hasSeenTool) mainThinking.append(delta);
    },

    onFirstToolSeen(): void {
      mainContent.flush();
      mainThinking.flush();
      msgList.update(turnRef.assistantId, (m) =>
        m ? { ...m, isStreaming: false } : m,
      );
    },

    onBeforeToolCalls(calls): void {
      for (const call of calls) {
        msgList.push(toolMsg({
          toolCallId: call.id,
          name: call.name,
          arguments: call.arguments ?? {},
          status: 'running',
        }));
      }
    },

    onTurnSnapshot(history): void {
      const turnStart = tracker.getTurnStart();
      if (turnStart >= history.length) return;
      tracker.advanceTurn(history);
    },

    onAfterToolCall(call, result): void {
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
          arguments: call.arguments ?? {},
          status: isError ? 'error' : 'done',
          ...(isError ? { error: result.result as string } : { result: result.result }),
          ...(result.attachments?.length ? { attachments: [...result.attachments] } : {}),
        }));
      }
    },

    onPreExecutedResult(call, res): void {
      msgList.push(toolMsg({
        toolCallId: call.id,
        name: call.name,
        arguments: call.arguments ?? {},
        status: 'done',
        result: res.result,
      }));
    },

    onAttachment(attachment): void {
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

    async onAfterTurn(history, usage, signal): Promise<AgentMessage[] | void> {
      const result = await scope.composeAfterTurn(history, tsCtx, usage, signal);
      if (result.changed || result.notices.length > 0) {
        tracker.advanceTurn([...result.history]);
        for (const notice of result.notices) {
          msgList.push({ ...assistantMsg(createId(), notice.content), attachments: notice.attachments });
          onCompactionNotices?.([notice]);
        }
        return result.history;
      }
      tracker.advanceTurn([...history]);
    },

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
