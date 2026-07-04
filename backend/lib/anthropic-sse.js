/**
 * backend/lib/anthropic-sse.js — Anthropic SSE Stream Reader
 *
 * Anthropic uses a different SSE format from OpenAI:
 * - Event types: 'content_block_start', 'content_block_delta',
 *   'content_block_stop', 'message_delta', 'message_stop'
 * - Each event has a 'type' field at the top level
 * - Text deltas come in 'content_block_delta' events with type 'text_delta'
 * - Thinking deltas come in 'content_block_delta' events with type 'thinking_delta'
 * - Tool calls come in 'content_block_start' events with type 'tool_use'
 * - Usage comes in 'message_delta' events
 *
 * Reference: https://docs.anthropic.com/en/api/messages-streaming
 */

/**
 * Read an Anthropic Messages API SSE stream.
 *
 * @param {ReadableStream<Uint8Array>} body     Response body from the Anthropic API
 * @param {(delta: string) => void}   onText    Called for each text delta
 * @param {(delta: string) => void}   onThinking Called for each thinking delta
 *
 * @returns {{ toolCalls: Array, usage?: object }}
 */
export async function readAnthropicSSE(body, onText, onThinking) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let currentBlockId = 0;
  let currentToolCall = null;
  let finishReason = null;
  let reportedUsage = null;
  const toolCalls = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('event:') && !line.startsWith('data:')) continue;

        // Anthropic sends event type on one line, data on the next
        // We process them together: "event: content_block_delta\ndata: {...}"
        if (line.startsWith('event:')) continue;

        const raw = line.slice(5).trim(); // strip "data: "
        if (!raw) continue;

        let event;
        try { event = JSON.parse(raw); } catch { continue; }

        const eventType = event.type;

        if (eventType === 'content_block_start') {
          currentBlockId = event.index ?? 0;
          if (event.content_block?.type === 'tool_use') {
            currentToolCall = {
              id: event.content_block.id,
              name: event.content_block.name,
              argsJson: '',
            };
          }
        } else if (eventType === 'content_block_delta') {
          const delta = event.delta;
          if (!delta) continue;
          if (delta.type === 'text_delta' && delta.text) {
            onText(delta.text);
          } else if (delta.type === 'thinking_delta' && delta.thinking) {
            onThinking(delta.thinking);
          } else if (delta.type === 'input_json_delta' && delta.partial_json && currentToolCall) {
            currentToolCall.argsJson += delta.partial_json;
          }
        } else if (eventType === 'content_block_stop') {
          if (currentToolCall) {
            toolCalls.push(currentToolCall);
            currentToolCall = null;
          }
        } else if (eventType === 'message_delta') {
          if (event.delta?.stop_reason) {
            finishReason = event.delta.stop_reason;
          }
          if (event.usage) {
            reportedUsage = {
              promptTokens: event.usage.input_tokens ?? 0,
              completionTokens: event.usage.output_tokens ?? 0,
              totalTokens: (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0),
            };
          }
        }
        // 'message_start', 'message_stop', 'ping' — no action needed
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Parse tool call arguments
  const parsedToolCalls = toolCalls.map((tc) => {
    let args = {};
    try { args = JSON.parse(tc.argsJson); } catch { /* ignore */ }
    return { id: tc.id, name: tc.name, arguments: args };
  });

  return {
    toolCalls: parsedToolCalls,
    finishReason,
    usage: reportedUsage,
  };
}
