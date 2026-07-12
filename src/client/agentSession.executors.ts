import { toErrorMessage } from '../tools/errors';
import type { ToolCall, ToolResult } from '@agent-type';
import type { Message, ToolCallInfo } from '../../agent-UI/components/AgentWidget/types';
import { createId, assistantMsg, toolMsg } from '../../agent-UI/components/AgentWidget/helpers';

export type SetMessages = (updater: (prev: Message[]) => Message[]) => void;

// ── Batched text / thinking setter ────────────────────────────────────────────
//
// Streaming AI responses can emit hundreds of tiny text deltas per second.
// Calling setMessages on every delta triggers a React re-render per character.
// Instead we accumulate deltas in a local buffer and flush once per animation
// frame (~60 fps), collapsing N setState calls into one per 16 ms window.
//
// `append` returns immediately (just string concat); the scheduled rAF does the
// single setMessages call for all accumulated text since the last flush.
// Works in both browser and non-browser environments (falls back to setTimeout).

type StringAppender = {
  /** Buffer `delta` for the next flush — returns immediately. */
  append(delta: string): void;
  /** Force-flush any buffered content synchronously (call on stream end). */
  flush(): void;
};

export function makeBatchedAppender(
  targetId: () => string,
  field: 'content' | 'thinking',
  setMessages: SetMessages,
): StringAppender {
  let buffer = '';
  let scheduled = false;

  function flush() {
    if (!buffer) return;
    const captured = buffer;
    buffer = '';
    scheduled = false;
    const id = targetId();
    setMessages((prev) =>
      prev.map((m) => m.id === id ? { ...m, [field]: (m[field] ?? '') + captured } : m),
    );
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, 0);
    }
  }

  return {
    append(delta) { buffer += delta; schedule(); },
    flush,
  };
}

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
