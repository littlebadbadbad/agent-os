/**
 * backend/lib/format-converters/chat-completions.js — OpenAI Chat Completions format
 *
 * Converter for apiType: 'chat-completions'
 *
 * Wire format: POST /v1/chat/completions
 * Body: { model, messages: [...], tools, tool_choice, stream }
 * Response: { choices: [{ message: { content, tool_calls, reasoning_content }, finish_reason }], usage }
 * Stream: SSE with data: {...} lines
 *
 * Registered in index.js via namespace import.
 */

import { resolveEndpoint } from './index.js';
import { toOAIMessages, readSSEStream, assembledToToolCall, extractThinking } from '../oai.js';
import { buildHeaders, post, throwHttpError, parseUsage } from '../http-client.js';
import { createProxyFetch } from '../proxy.js';

// ── Async (non-streaming) ────────────────────────────────────────────────────

/**
 * @param {Array}  messages
 * @param {Array}  [tools]
 * @param {string} [toolChoice]
 * @param {AbortSignal} [signal]
 * @param {string} [systemPrompt]
 * @param {string} model
 * @param {string} providerName
 * @returns {Promise<{text:string, thinking?:string, toolCalls:Array, usage?:object}>}
 */
export async function callAsync(messages, tools, toolChoice, signal, systemPrompt, model, providerName) {
  const { url, apiKey, useProxy } = resolveEndpoint(providerName, model);
  const doFetch = useProxy ? createProxyFetch() : undefined;

  const resp = await post(url, buildHeaders(apiKey), {
    model,
    messages: toOAIMessages(messages, systemPrompt, model),
    tools: tools?.length ? tools : undefined,
    tool_choice: tools?.length ? toolChoice : undefined,
  }, signal, doFetch);

  if (!resp.ok) await throwHttpError(resp, providerName ?? model);

  const data = await resp.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error(`Empty response from ${providerName ?? model} API`);

  // Universal thinking extraction:
  // 1. reasoning_content field (DeepSeek/Doubao style)
  // 2. tag-mode <think>...</think> (Qwen style)
  let thinking = undefined;
  let text = (msg.content ?? '').trim();

  if (msg.reasoning_content != null) {
    thinking = msg.reasoning_content.trim() || undefined;
  } else if (typeof text === 'string') {
    const extracted = extractThinking(text);
    thinking = extracted.thinking || undefined;
    text = extracted.text;
  }

  return {
    text,
    thinking,
    toolCalls: msg.tool_calls?.map((tc) =>
      assembledToToolCall({ id: tc.id, name: tc.function.name, argsJson: tc.function.arguments }),
    ),
    usage: parseUsage(data.usage),
  };
}

// ── Streaming ────────────────────────────────────────────────────────────────

/**
 * @param {Array}  messages
 * @param {Array}  [tools]
 * @param {string} [toolChoice]
 * @param {AbortSignal} signal
 * @param {(delta:string) => void} onText
 * @param {(delta:string) => void} onThinking
 * @param {string} [systemPrompt]
 * @param {string} model
 * @param {string} providerName
 * @returns {Promise<{toolCalls:Array, usage?:object}>}
 */
export async function callStream(messages, tools, toolChoice, signal, onText, onThinking, systemPrompt, model, providerName) {
  const { url, apiKey, useProxy } = resolveEndpoint(providerName, model);
  const doFetch = useProxy ? createProxyFetch() : undefined;

  const resp = await post(url, buildHeaders(apiKey), {
    model,
    messages: toOAIMessages(messages, systemPrompt, model),
    tools: tools?.length ? tools : undefined,
    tool_choice: tools?.length ? toolChoice : undefined,
    stream: true,
    stream_options: { include_usage: true },
  }, signal, doFetch);

  if (!resp.ok) await throwHttpError(resp, providerName ?? model);

  return readSSEStream(resp.body, onText, onThinking, 'field');
}
