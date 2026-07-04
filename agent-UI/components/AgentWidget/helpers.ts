import type { Message, ToolCallInfo } from "./types";

export function createId(): string {
  return crypto.randomUUID();
}

export const assistantMsg = (
  id: string,
  content: string,
  streaming = false,
): Message => ({
  id,
  role: "assistant",
  content,
  isStreaming: streaming,
});

export const toolMsg = (info: ToolCallInfo): Message => ({
  id: info.toolCallId,
  role: "tool",
  content: "",
  isStreaming: false,
  toolCall: info,
});
