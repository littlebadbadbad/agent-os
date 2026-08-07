import type { AgentMessage } from '@agent-type';
import { MAX_TOOL_RESULT_CHARS } from './constants';

/**
 * Yield control back to the browser event loop once.
 * Prevents long synchronous work from blocking the main thread.
 */
export const yieldToFrame = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Rough token estimation: ~4 characters per token for English,
 * ~2 characters per token for CJK / code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u3000-\u9fff\uf900-\ufaff\ufe30-\ufe4f]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(rest / 4 + cjk / 2);
}

/**
 * Serialize a tool-result payload to text for token estimation.
 * Strings pass through unchanged; `null`/`undefined` become empty; anything
 * else is JSON-serialized.
 */
export function serializeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  return JSON.stringify(content);
}

/** Serialize a message array to a plain text transcript for summarization. */
export function messagesToText(messages: readonly AgentMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === 'tool') {
        const raw =
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        const content =
          raw.length > MAX_TOOL_RESULT_CHARS
            ? `${raw.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated ${raw.length - MAX_TOOL_RESULT_CHARS} chars]`
            : raw;
        return `[tool_result:${m.name}] ${content}`;
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const calls = m.toolCalls
          .map((tc) => `${tc.name}(${JSON.stringify(tc.arguments)})`)
          .join(', ');
        const text = m.content
          ? `${m.content}\n[tool_calls: ${calls}]`
          : `[tool_calls: ${calls}]`;
        return `[assistant] ${text}`;
      }
      return `[${m.role}] ${m.content}`;
    })
    .join('\n');
}
