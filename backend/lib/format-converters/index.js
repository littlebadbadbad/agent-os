/**
 * backend/lib/format-converters/index.js — Format converter registry
 *
 * Factory that selects the appropriate format converter based on apiType.
 *
 * Three apiType values:
 *   'chat-completions' — OpenAI Chat Completions format (current default)
 *   'responses'        — OpenAI Responses API (newer format)
 *   'messages'         — Anthropic Messages format
 *
 * Each converter implements the same interface (see converter-interface.md):
 *   buildRequest(...)  → { url, headers, body }
 *   parseResponse(...) → { text, thinking, toolCalls, usage }
 *   createStreamReader(...) → (response) => { promise }
 */

import { createLogger } from '../logger.js';
import { getMergedModelConfig } from '../../services/model-config.js';
import { resolveApiKey } from './resolve-key.js';

// Static imports ensure converter modules are loaded before any code runs.
// Each module is imported as a namespace so its exported { callAsync, callStream }
// are available for the REGISTRY. No circular-dependency issues because
// resolveEndpoint is only used at runtime, not at module init time.
import * as chatCompletionsConv from './chat-completions.js';
import * as responsesConv from './responses.js';
import * as messagesConv from './messages.js';

const log = createLogger('format-converters');

// ── Converter registry (populated from static imports) ────────────────────────

const REGISTRY = {
  'chat-completions': chatCompletionsConv,
  'responses': responsesConv,
  'messages': messagesConv,
};

/**
 * Register a converter for a given apiType.
 * Called by each converter module at import time.
 *
 * @param {string} apiType
 * @param {object} converter
 */
export function registerConverter(apiType, converter) {
  REGISTRY[apiType] = converter;
}

/**
 * Get the format converter for a given apiType.
 *
 * @param {string} apiType — 'chat-completions' | 'responses' | 'messages'
 * @returns {object} converter interface
 */
export function getConverter(apiType) {
  const converter = REGISTRY[apiType];
  if (!converter) {
    throw new Error(
      `Unknown apiType "${apiType}". Valid: ${Object.keys(REGISTRY).join(', ')}. ` +
      'Available converters: chat-completions, responses, messages',
    );
  }
  return converter;
}

/**
 * Resolve the full endpoint configuration for a provider+model call.
 *
 * @param {string} providerName
 * @param {string} model
 * @returns {{ url: string, apiKey: string, modelConfig: object, providerConfig: object }}
 */
export function resolveEndpoint(providerName, model) {
  const modelConfig = getMergedModelConfig(providerName, model);
  if (!modelConfig) {
    throw new Error(
      `Model "${model}" not found in provider config${providerName ? ` for "${providerName}"` : ''}. ` +
      'Edit custom-provider-config.json to add it.',
    );
  }

  const { url } = modelConfig.model;
  const apiKey = resolveApiKey(providerName);

  if (!apiKey) {
    throw new Error(
      `API key for "${providerName}" is not set. Use the API Keys tab in settings to configure it, ` +
      'or set the appropriate environment variable.',
    );
  }

  return { url, apiKey, modelConfig: modelConfig.model, providerConfig: modelConfig.provider };
}

/**
 * Resolve the apiType for a provider from the config.
 *
 * @param {string} providerName
 * @returns {string} — defaults to 'chat-completions'
 */
export async function resolveApiType(providerName) {
  const { getMergedProvider } = await import('../../services/model-config.js');
  const provider = getMergedProvider(providerName);
  const apiType = provider?.apiType ?? 'chat-completions';
  if (!REGISTRY[apiType]) {
    log.warn(`apiType "${apiType}" for provider "${providerName}" has no registered converter, falling back to chat-completions`);
    return 'chat-completions';
  }
  return apiType;
}
