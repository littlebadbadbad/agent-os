/**
 * Generic AI provider — orchestrator (apiType-agnostic).
 *
 * Unlike the old per-vendor provider files (deepseek.js, doubao.js, etc.),
 * this single adapter handles ALL vendors defined in the provider config file.
 *
 * The actual API format conversion is delegated to format converters:
 *   'chat-completions' — OpenAI Chat Completions (default)
 *   'responses'        — OpenAI Responses API
 *   'messages'         — Anthropic Messages / Claude
 *
 * The URL, model id, capabilities, and apiType are read from provider-config.json
 * at call time — zero hardcoded URLs, zero hardcoded model lists.
 */

import { createLogger } from '../lib/logger.js';
import { getConverter as lookupConverter, resolveApiType } from '../lib/format-converters/index.js';

const log = createLogger('customendpoint');

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Get the right format converter for a provider+model call.
 *
 * @param {string} model
 * @param {string} [providerName]
 * @returns {object} converter with { callAsync, callStream }
 */
async function getConverter(model, providerName) {
  const apiType = providerName ? await resolveApiType(providerName) : 'chat-completions';
  const converter = lookupConverter(apiType);
  log.info(`Resolved apiType="${apiType}" for provider="${providerName}" model="${model}"`);
  return converter;
}

// ── Async (non-streaming) ────────────────────────────────────────────────────

/**
 * @param {Array}  messages
 * @param {Array}  [tools]
 * @param {string} [toolChoice]
 * @param {AbortSignal} [signal]
 * @param {string} [systemPrompt]
 * @param {string} model — model id (used to look up URL from config)
 * @param {string} [providerName] — provider name for config lookup
 * @returns {Promise<{text:string, thinking?:string, toolCalls:Array, usage?:object}>}
 */
export async function callAsync(messages, tools, toolChoice, signal, systemPrompt, model, providerName) {
  const converter = await getConverter(model, providerName);
  return converter.callAsync(messages, tools, toolChoice, signal, systemPrompt, model, providerName);
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
 * @param {string} model — model id (used to look up URL from config)
 * @param {string} [providerName] — provider name for config lookup
 * @returns {Promise<{text:string, toolCalls:Array, usage?:object}>}
 */
export async function callStream(messages, tools, toolChoice, signal, onText, onThinking, systemPrompt, model, providerName) {
  const converter = await getConverter(model, providerName);
  return converter.callStream(messages, tools, toolChoice, signal, onText, onThinking, systemPrompt, model, providerName);
}
