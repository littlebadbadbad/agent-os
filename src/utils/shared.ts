/**
 * Cross-layer shared utilities.
 *
 * Extracted from `agent-UI/components/AgentWidget/` to eliminate the
 * SDK-core → UI-layer dependency.  Both `src/` (SDK core) and
 * `agent-UI/` (UI layer) import from this single module.
 */

import type { ToolCallInfo } from '@agent-type';

// ── ID generation ─────────────────────────────────────────────────────────────

export function createId(): string {
  return crypto.randomUUID();
}

// ── UI Message type ───────────────────────────────────────────────────────────

export type Message = {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly isStreaming: boolean;
  /** Reasoning/thinking text shown in a collapsible block above the reply. */
  readonly thinking?: string;
  /** Present only when role === 'tool'. */
  readonly toolCall?: ToolCallInfo;
  /** Multimodal attachments attached by the user or produced by the assistant. */
  readonly attachments?: readonly import('@agent-type').Attachment[];
};

export type { ToolCallInfo } from '@agent-type';

// ── UI message constructors ───────────────────────────────────────────────────

export const assistantMsg = (
  id: string,
  content: string,
  streaming = false,
): Message => ({
  id,
  role: 'assistant',
  content,
  isStreaming: streaming,
});

export const toolMsg = (info: ToolCallInfo): Message => ({
  id: info.toolCallId,
  role: 'tool',
  content: '',
  isStreaming: false,
  toolCall: info,
});
