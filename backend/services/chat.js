/**
 * backend/lib/services/chat.js — Chat business logic
 *
 * ALL business logic shared by HTTP routes and IPC handlers.
 * Pure functions — no knowledge of HTTP, IPC, or Electron.
 *
 * Uses the generic customendpoint provider for ALL vendors.
 * Provider/model config is read from data/provider-config.json.
 */

import * as customendpoint from '../providers/customendpoint.js';
import { createLogger } from '../lib/logger.js';
import { assembledToToolCall } from '../lib/oai.js';
import { logChat } from '../lib/chat-log.js';

const log = createLogger('chat-service');

/**
 * The frontend sends ToolDescriptor[] — vendor-agnostic {name, description, parameters}.
 * OAI-compatible APIs expect {type:'function', function:{name,description,parameters}}.
 * Detect which format is present and normalise to OAI format.
 */
function toOAITools(tools) {
  if (!tools?.length) return [];
  if (tools[0].type !== undefined) return tools;
  return tools.map((t) => ({ type: 'function', function: t }));
}

// ── Async (non-streaming) ────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {string} params.provider
 * @param {string} [params.model]
 * @param {Array}  params.messages
 * @param {Array}  [params.tools]
 * @param {string} [params.toolChoice]
 * @param {string} [params.systemPrompt]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{text:string, toolCalls:Array, usage?:object}>}
 */
export async function callAsync({ provider: providerName, model, messages, tools, toolChoice, systemPrompt, signal }) {
  const oaiTools = toOAITools(tools);
  return customendpoint.callAsync(messages, oaiTools, toolChoice ?? 'auto', signal, systemPrompt, model, providerName);
}

// ── Streaming ────────────────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {string} params.provider
 * @param {string} [params.model]
 * @param {Array}  params.messages
 * @param {Array}  [params.tools]
 * @param {string} [params.toolChoice]
 * @param {string} [params.systemPrompt]
 * @param {AbortSignal} params.signal
 * @param {(delta:string) => void} params.onText
 * @param {(delta:string) => void} params.onThinking
 * @returns {Promise<{text:string, toolCalls:Array, usage?:object}>}
 */
export async function callStream({ provider: providerName, model, messages, tools, toolChoice, systemPrompt, signal, onText, onThinking }) {
  const oaiTools = toOAITools(tools);
  return customendpoint.callStream(
    messages,
    oaiTools,
    toolChoice ?? 'auto',
    signal,
    onText,
    onThinking,
    systemPrompt,
    model,
    providerName,
  );
}

// ── Chat audit log ───────────────────────────────────────────────────────────

/**
 * Log a chat interaction to the audit trail.
 */
export function logChatInteraction({ provider, mode, messages, tools, toolChoice, systemPrompt, responseText, responseToolCalls, error, durationMs }) {
  logChat({
    provider,
    mode,
    messages,
    tools,
    toolChoice,
    systemPrompt,
    responseText,
    responseToolCalls,
    error,
    durationMs,
  });
}

/**
 * callAsync with built-in audit logging.
 * Use this from transport layers — never call logChatInteraction directly.
 */
export async function callAsyncWithLogging({ provider, model, messages, tools, toolChoice, systemPrompt, signal }) {
  const t0 = Date.now();
  try {
    const result = await callAsync({ provider, model, messages, tools, toolChoice, systemPrompt, signal });
    const durationMs = Date.now() - t0;
    logChatInteraction({
      provider, mode: 'async', messages, tools, toolChoice, systemPrompt,
      responseText: result.text, responseToolCalls: result.toolCalls, durationMs,
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - t0;
    logChatInteraction({
      provider, mode: 'async', messages, tools, toolChoice, systemPrompt,
      error: err.message, durationMs,
    });
    throw err;
  }
}

/**
 * callStream with built-in audit logging and tool-call conversion.
 * Returns proper tool calls ready for transport layers.
 */
export async function callStreamWithLogging({ provider, model, messages, tools, toolChoice, systemPrompt, signal, onText, onThinking }) {
  try {
    const result = await callStream({ provider, model, messages, tools, toolChoice, systemPrompt, signal, onText, onThinking });
    const convertedToolCalls = result.toolCalls.map(assembledToToolCall);
    logChatInteraction({
      provider, mode: 'stream', messages, tools, toolChoice, systemPrompt,
      responseToolCalls: result.toolCalls.length > 0 ? result.toolCalls : null,
    });
    return { ...result, toolCalls: convertedToolCalls };
  } catch (err) {
    logChatInteraction({
      provider, mode: 'stream', messages, tools, toolChoice, systemPrompt,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Start a chat streaming session with built-in lifecycle management.
 *
 * Generates a unique sessionId, creates an AbortController, initiates the
 * streaming call, and invokes the supplied callbacks for each event type.
 *
 * Transport layers provide the callbacks — this function handles all business
 * logic (session creation, stream initiation, error conversion).
 *
 * @param {object} params
 * @param {string}   params.provider
 * @param {string}   [params.model]
 * @param {Array}    params.messages
 * @param {Array}    [params.tools]
 * @param {string}   [params.toolChoice]
 * @param {string}   [params.systemPrompt]
 * @param {(delta: string) => void} params.onText
 * @param {(delta: string) => void} params.onThinking
 * @param {(call: object) => void}  params.onToolCall
 * @param {(usage: object) => void} params.onUsage
 * @param {(result: { toolCalls: Array, sessionId: string }) => void} params.onDone
 * @param {(error: string) => void} params.onError
 * @returns {{ sessionId: string, abortController: AbortController }}
 */
export function startChatStreamingSession({
  provider, model, messages, tools, toolChoice, systemPrompt,
  onText, onThinking, onToolCall, onUsage, onDone, onError,
}) {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const abortController = new AbortController();

  callStreamWithLogging({
    provider,
    model,
    messages,
    tools,
    toolChoice,
    systemPrompt,
    signal: abortController.signal,
    onText: (delta) => { try { onText(delta); } catch { /* ignore */ } },
    onThinking: (delta) => { try { onThinking(delta); } catch { /* ignore */ } },
  }).then((result) => {
    for (const tc of result.toolCalls) {
      try { onToolCall(tc); } catch { /* ignore */ }
    }
    if (result.usage) {
      try { onUsage(result.usage); } catch { /* ignore */ }
    }
    try { onDone({ toolCalls: result.toolCalls.length, sessionId }); } catch { /* ignore */ }
  }).catch((err) => {
    if (!abortController.signal.aborted) {
      try { onError(err.message); } catch { /* ignore */ }
    }
  });

  return { sessionId, abortController };
}
