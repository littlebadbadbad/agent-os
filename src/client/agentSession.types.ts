import type { WidgetHandler, ToolCall, ToolResult, AgentMessage, Attachment, AgentSessionState, ToolSetContext } from '@agent-type';
import type { Message } from '@agent-sdk/utils/shared';
import type { ToolSetScope } from '@agent-sdk/tools/toolSetScope';

export type { AgentSessionState } from '@agent-type';

declare module '@agent-type' {
  interface AgentSessionExtension {
    messages: Message[];
    agentId: string | undefined;
    title: string;
    enableAttachments: boolean;
  }
}

export type AgentSessionConfig = {
  getHandler: (userMessage?: string) => WidgetHandler;
  id: string;
  agentName: string;
  conversationId: string;
  agentId?: string;
  title?: string;
  callTool: (call: ToolCall, signal: AbortSignal) => Promise<ToolResult>;
  maxAgentTurns: number;
  scope: ToolSetScope;
  tsCtx: ToolSetContext;
  getExternalState: (prevState?: AgentSessionState) => Partial<AgentSessionState>;
  subscribeExternalState: (fn: () => void) => () => void;
  initialMessages?: AgentMessage[];
  liveHistory?: AgentMessage[];
  enableAttachments: boolean;
  onClearHistory: () => void;
  onInterceptMessage?: (text: string, attachments: readonly Attachment[] | undefined, isLoading: boolean) => boolean;
};

export type AgentSession = {
  sendMessage(text: string, attachments?: readonly Attachment[]): Promise<void>;
  editAndSendMessage(messageId: string, newText: string, attachments?: readonly Attachment[]): Promise<void>;
  cancelMessage(): void;
  clearHistory(): void;
  setTitle(title: string): void;
  getState(): AgentSessionState;
  subscribe(fn: () => void): () => void;
  getHistory(): AgentMessage[];
  getLiveHistory(): AgentMessage[];
  injectToolResult(toolCallId: string, name: string, result: unknown): Promise<void>;
};
