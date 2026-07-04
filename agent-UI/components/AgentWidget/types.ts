import type { Attachment } from '@agent-sdk';
import type { ToolCallInfo } from '@agent-type';
export type { Attachment };

// ToolCallStatus and ToolCallInfo now live in @agent-type (agent-type/plugin.ts)
// and are re-exported here for backward compatibility with existing imports.
export type { ToolCallStatus, ToolCallInfo } from '@agent-type';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  isStreaming: boolean;
  /** Reasoning/thinking text shown in a collapsible block above the reply. */
  thinking?: string;
  /** Present only when role === 'tool'. */
  toolCall?: ToolCallInfo;
  /** Multimodal attachments attached by the user or produced by the assistant. */
  attachments?: readonly Attachment[];
}
