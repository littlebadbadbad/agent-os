import { toErrorMessage } from '../tools/errors';
import type { ToolCall, ToolResult } from '@agent-type';
import type { Message, ToolCallInfo } from '@agent-sdk/utils/shared';
import { createId, assistantMsg, toolMsg } from '@agent-sdk/utils/shared';

export type SetMessages = (updater: (prev: Message[]) => Message[]) => void;

// ── Tool execution ────────────────────────────────────────────────────────────

export function buildRunToolCall(
  setMessages: SetMessages,
  callTool: (call: ToolCall, signal: AbortSignal) => Promise<ToolResult>,
  getSignal: () => AbortSignal,
) {
  return async function runToolCall(call: ToolCall): Promise<ToolResult> {
    const info: ToolCallInfo = {
      toolCallId: call.id,
      name: call.name,
      arguments: call.arguments,
      status: 'running',
    };
    setMessages((prev) => [...prev, toolMsg(info)]);

    try {
      const res = await callTool(call, getSignal());
      setMessages((prev) =>
        prev.map((m) =>
          m.id === call.id
            ? { ...m, toolCall: { ...m.toolCall!, status: 'done', result: res.result, ...(res.attachments?.length ? { attachments: [...res.attachments] } : {}) } }
            : m,
        ),
      );
      return res;
    } catch (err) {
      const errMsg = toErrorMessage(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === call.id
            ? { ...m, toolCall: { ...m.toolCall!, status: 'error', error: errMsg } }
            : m,
        ),
      );
      return { toolCallId: call.id, name: call.name, result: `Error: ${errMsg}` };
    }
  };
}
