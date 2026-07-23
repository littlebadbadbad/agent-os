/**
 * backend/core/chat.js — Super built-in "chat" plugin
 *
 * Registers chat API methods via defineApi() and defineStream().
 *
 * Methods:
 *   async       — Non-streaming chat (callAsyncWithLogging)
 *   streamStop  — Abort an in-flight streaming session by sessionId
 *
 * Streams:
 *   chatStream  — Streaming chat via defineStream + StreamConnection.
 *                 Runs on the shared pluginRouter so both HTTP (WebSocket)
 *                 and IPC transports handle it transparently — no more
 *                 inline SSE handler or ipcMain.handle().
 *
 * The streaming handler receives transport-agnostic `io.sendJSON()` and
 * uses it to push typed chunks (text, thinking, tool_call, usage, done, error)
 * to the connected client.  Cleanup happens when the transport disconnects.
 */

import { createCorePluginHost } from '../lib/core-plugin-host.js';
import * as chatService from '../services/chat.js';
import { createLogger } from '../lib/logger.js';

const PLUGIN_ID = 'chat';
const log = createLogger('core-chat');

/**
 * Map: sessionId → { params, abortController }
 * streamStart stores full params here; chatStream handler reads them by sessionId.
 * @type {Map<string, { params: Record<string, unknown>, abortController: AbortController }>}
 */
const _sessionStore = new Map();

/** Generate a short unique session ID. */
function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {import('../lib/plugin-router.js').pluginRouter} router */
export function register(router) {
  const host = createCorePluginHost(PLUGIN_ID, router);

  // ── Async (non-streaming) ─────────────────────────────────────────────────
  host.defineApi('async', async (params) => {
    const { provider: providerName, model, messages, tools, toolChoice, systemPrompt } = params ?? {};
    log.info('→ chat:async', { provider: providerName, model, messages: messages?.length ?? 0 });

    try {
      const result = await chatService.callAsyncWithLogging({
        provider: providerName,
        model,
        messages,
        tools,
        toolChoice,
        systemPrompt,
      });
      log.ok('← chat:async done', { toolCalls: result.toolCalls?.length ?? 0 });
      return result;
    } catch (err) {
      log.error('← chat:async error', err.message);
      throw err;
    }
  });

  // ── Stream: start (store params, returns sessionId) ──────────────────────
  // Two-phase streaming avoids serialising complex objects (messages, tools)
  // through the transport's query-string params, which only support flat strings.
  // Phase 1: call('streamStart', { provider, model, messages, ... }) → { sessionId }
  // Phase 2: connectStream('chatStream', { sessionId }) → starts streaming
  host.defineApi('streamStart', async (params) => {
    const sessionId = generateSessionId();
    const abortController = new AbortController();
    _sessionStore.set(sessionId, { params: params ?? {}, abortController });
    log.info('→ streamStart', { sessionId });
    return { sessionId };
  });

  // ── Stream: stop (manual abort by sessionId) ─────────────────────────────
  host.defineApi('streamStop', async (params) => {
    const { sessionId } = params ?? {};
    if (!sessionId) return { ok: false };
    const entry = _sessionStore.get(sessionId);
    if (entry) {
      entry.abortController.abort();
      _sessionStore.delete(sessionId);
      log.info('← streamStop — aborted', { sessionId });
    }
    return { ok: true };
  });

  // ── Stream: transport-agnostic streaming ─────────────────────────────────
  // Receives { sessionId } from the transport, looks up stored params.
  host.defineStream('chatStream', (params, io) => {
    const { sessionId } = params ?? {};
    const entry = sessionId ? _sessionStore.get(sessionId) : undefined;
    if (!entry) {
      io.sendJSON({ type: 'error', error: `No session found for id: ${sessionId}` });
      return { subscribe: () => ({ unsubscribe: () => {} }) };
    }

    const { provider: providerName, model, messages, tools, toolChoice, systemPrompt } = entry.params;
    const abortController = entry.abortController;
    log.info('→ chatStream connect', { sessionId, provider: providerName, model, messages: messages?.length ?? 0 });

    return {
      subscribe: () => {
        const { sessionId: sid } = chatService.startChatStreamingSession({
          provider: providerName,
          model,
          messages,
          tools,
          toolChoice,
          systemPrompt,
          onText: (delta) => io.sendJSON({ type: 'text', delta }),
          onThinking: (delta) => io.sendJSON({ type: 'thinking', delta }),
          onToolCall: (tc) => io.sendJSON({ type: 'tool_call', call: tc }),
          onUsage: (usage) => io.sendJSON({ type: 'usage', usage }),
          onDone: (result) => io.sendJSON({ type: 'done', result }),
          onError: (error) => io.sendJSON({ type: 'error', error: error instanceof Error ? error.message : String(error) }),
        });

        // Clean up session store when the transport disconnects.
        io.onClose(() => {
          _sessionStore.delete(sessionId);
        });

        return {
          unsubscribe: () => {
            abortController.abort();
            _sessionStore.delete(sessionId);
          },
        };
      },
    };
  });
}
