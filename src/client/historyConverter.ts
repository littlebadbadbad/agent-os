import type { AgentMessage } from '@agent-type';
import { createId } from '@agent-sdk/utils/shared';
import type { Message } from '@agent-sdk/utils/shared';
import { SUMMARY_ANCHOR_PREFIX, SUMMARY_ANCHOR_ACK } from '../constants';

/**
 * Convert raw LLM-facing history to UI display messages.
 * Used when restoring a session from saved state.
 */
export function agentMessagesToUI(history: readonly AgentMessage[]): Message[] {
  // Pre-build a map of toolCallId → arguments from assistant messages so
  // tool-result bubbles can show the call arguments.
  const toolArgsByCallId = new Map<string, Record<string, unknown>>();
  for (const msg of history) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        toolArgsByCallId.set(tc.id, tc.arguments as Record<string, unknown>);
      }
    }
  }

  const uiMessages: Message[] = [];
  let i = 0;

  while (i < history.length) {
    const msg = history[i];

    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const nextMsg = history[i + 1];

      // Skip summarization anchor pairs — internal LLM scaffolding, not UI content.
      // Emit a compressed-context notice so the user knows a summary occurred.
      if (
        content.startsWith(SUMMARY_ANCHOR_PREFIX) &&
        nextMsg?.role === 'assistant' &&
        nextMsg.content.trim() === SUMMARY_ANCHOR_ACK
      ) {
        uiMessages.push({
          id: createId(),
          role: 'assistant',
          content: '_Context compressed (restored from summary)_',
          isStreaming: false,
        });
        i += 2;
        continue;
      }

      uiMessages.push({
        id: createId(),
        role: 'user',
        content,
        isStreaming: false,
        attachments: msg.attachments,
      });
    } else if (msg.role === 'assistant') {
      if (msg.content) {
        uiMessages.push({
          id: createId(),
          role: 'assistant',
          content: msg.content,
          isStreaming: false,
          attachments: msg.attachments,
        });
      }
    } else if (msg.role === 'tool') {
      uiMessages.push({
        id: msg.toolCallId,
        role: 'tool',
        content: '',
        isStreaming: false,
        toolCall: {
          toolCallId: msg.toolCallId,
          name: msg.name,
          arguments: toolArgsByCallId.get(msg.toolCallId) ?? {},
          status: 'done',
          result: msg.content,
        },
      });
    }

    i++;
  }

  return uiMessages;
}
