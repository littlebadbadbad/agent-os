/**
 * backend/lib/format-converters/responses.js — OpenAI Responses API format
 *
 * Converter for apiType: 'responses'
 *
 * Wire format: POST /v1/responses
 * Body: { model, input: [...], tools: [...], tool_choice }
 * Response: { output: [...], usage: { input_tokens, output_tokens } }
 *
 * The Responses API uses a different structure from Chat Completions:
 * - 'input' instead of 'messages'
 * - No 'role' on user messages in the same way
 * - Tool calls are 'function_call' output items
 * - Streaming uses Server-Sent Events (SSE) with 'response.output_items.delta' events
 *
 * Registered in index.js via namespace import.
 */

import { resolveEndpoint } from './index.js';
import { toOAIMessages, readSSEStream, assembledToToolCall, extractThinking } from '../oai.js';
import { buildHeaders, post, throwHttpError, parseUsage } from '../http-client.js';
import { createProxyFetch } from '../proxy.js';

/**
 * Convert SDK messages to Responses API format.
 * Responses API uses 'input' (not 'messages') with a different structure.
 * For simplicity and broad compat, we reuse toOAIMessages but wrap structure.
 *
 * @param {Array} messages
 * @param {string} systemPrompt
 * @param {string} model
 * @returns {Array} input array for Responses API
 */
function toResponsesInput(messages, systemPrompt, model) {
  const oaiMessages = toOAIMessages(messages, systemPrompt, model);
  // Responses API puts system in 'instructions' field, not as a message.
  // The first message is always system, so strip it.
  const input = oaiMessages.slice(1);
  return input;
}

/**
 * Build the request body for Responses API.
 * System prompt goes to 'instructions' field.
 */
function buildRequestBody(model, messages, tools, toolChoice, systemPrompt) {
  const body = {
    model,
    input: toResponsesInput(messages, systemPrompt, model),
  };

  // System prompt → instructions field
  const effectivePrompt = systemPrompt ?? 'You are a helpful assistant.';
  body.instructions = effectivePrompt;

  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice ?? 'auto';
  }

  return body;
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
  const { url, apiKey, useProxy } = resolveEndpoint(providerName, model);
  const doFetch = useProxy ? createProxyFetch() : undefined;

  const resp = await post(url, buildHeaders(apiKey), buildRequestBody(model, messages, tools, toolChoice, systemPrompt), signal, doFetch);

  if (!resp.ok) await throwHttpError(resp, providerName ?? model);

  const data = await resp.json();

  // Parse Responses API output format
  let text = '';
  const toolCalls = [];
  let thinking = undefined;

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message') {
        for (const content of item.content ?? []) {
          if (content.type === 'output_text') {
            // Check for thinking in text
            const extracted = extractThinking(content.text ?? '');
            if (extracted.thinking) thinking = extracted.thinking;
            text += extracted.text;
          }
        }
      } else if (item.type === 'function_call') {
        toolCalls.push(
          assembledToToolCall({
            id: item.id,
            name: item.name,
            argsJson: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
          }),
        );
      }
    }
  }

  text = text.trim();
  if (data.thinking) {
    thinking = data.thinking;
  }

  return {
    text,
    thinking: thinking || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
    ...buildRequestBody(model, messages, tools, toolChoice, systemPrompt),
    stream: true,
  }, signal, doFetch);

  if (!resp.ok) await throwHttpError(resp, providerName ?? model);

  // Responses API streaming uses different SSE event types from chat-completions.
  // For broadest compat, we stream 'field' mode and the Responses SSE reader.
  return readSSEStream(resp.body, onText, onThinking, 'field');
}
