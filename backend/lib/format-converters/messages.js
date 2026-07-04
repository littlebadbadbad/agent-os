/**
 * backend/lib/format-converters/messages.js — Anthropic Messages format
 *
 * Converter for apiType: 'messages'
 *
 * Wire format: POST /v1/messages
 * Body: { model, messages: [...], system: [...], tools: [...], max_tokens, stream }
 * Response: { id, type: 'message', role: 'assistant', content: [...], stop_reason, usage }
 * Stream: Anthropic SSE format (see anthropic-sse.js)
 *
 * Key differences from chat-completions:
 * - System prompt is a top-level 'system' field
 * - No 'system' message role
 * - Tool calls are 'tool_use' content blocks inside a single assistant message
 * - Tool results are 'tool_result' content blocks inside user messages
 * - Images use 'image' type with 'source' object (base64 or URL)
 * - API key goes in 'x-api-key' header, not 'Authorization' Bearer
 * - Requires 'anthropic-version' header
 * - Requires 'max_tokens' field
 *
 * Registered in index.js via namespace import.
 */

import { resolveEndpoint } from './index.js';
import { toAnthropicMessages, toAnthropicTools, parseAnthropicResponse } from '../anthropic.js';
import { buildAnthropicHeaders, post, throwHttpError, parseAnthropicUsage } from '../http-client.js';
import { readAnthropicSSE } from '../anthropic-sse.js';

/**
 * Determine max_tokens for a model.
 * Reads from provider config if available, otherwise uses a safe default.
 *
 * @param {string} providerName
 * @param {object} modelConfig
 * @returns {number}
 */
function getMaxTokens(providerName, modelConfig) {
  return modelConfig?.maxOutputTokens ?? 4096;
}

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
  const { url, apiKey, modelConfig } = resolveEndpoint(providerName, model);

  const { system, messages: anthroMessages } = toAnthropicMessages(messages, systemPrompt, model);

  const body = {
    model,
    messages: anthroMessages,
    system,
    max_tokens: getMaxTokens(providerName, modelConfig),
    tools: toAnthropicTools(tools),
  };

  // Map tool_choice
  if (tools?.length && toolChoice) {
    if (toolChoice === 'none') {
      body.tool_choice = { type: 'none' };
    } else if (toolChoice === 'auto') {
      body.tool_choice = { type: 'auto' };
    } else if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
      body.tool_choice = { type: 'tool', name: toolChoice.function?.name ?? toolChoice.name };
    }
  }

  const resp = await post(url, buildAnthropicHeaders(apiKey), body, signal);

  if (!resp.ok) await throwHttpError(resp, providerName ?? model);

  const data = await resp.json();
  const parsed = parseAnthropicResponse(data);

  return {
    text: parsed.text ?? '',
    thinking: parsed.thinking,
    toolCalls: parsed.toolCalls?.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments ?? {},
    })),
    usage: parseAnthropicUsage(data.usage),
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
  const { url, apiKey, modelConfig } = resolveEndpoint(providerName, model);

  const { system, messages: anthroMessages } = toAnthropicMessages(messages, systemPrompt, model);

  const body = {
    model,
    messages: anthroMessages,
    system,
    max_tokens: getMaxTokens(providerName, modelConfig),
    tools: toAnthropicTools(tools),
    stream: true,
  };

  // Map tool_choice (same as async)
  if (tools?.length && toolChoice) {
    if (toolChoice === 'none') {
      body.tool_choice = { type: 'none' };
    } else if (toolChoice === 'auto') {
      body.tool_choice = { type: 'auto' };
    } else if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
      body.tool_choice = { type: 'tool', name: toolChoice.function?.name ?? toolChoice.name };
    }
  }

  const resp = await post(url, buildAnthropicHeaders(apiKey), body, signal);

  if (!resp.ok) await throwHttpError(resp, providerName ?? model);

  return readAnthropicSSE(resp.body, onText, onThinking);
}
