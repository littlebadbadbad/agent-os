/**
 * /api/chat and /api/chat/stream route handlers.
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: parse HTTP request → call service → send HTTP response.
 *
 * POST /api/chat
 *   Body: { provider, messages, tools, toolChoice }
 *   Returns: AgentTurnResponse as JSON
 *
 * POST /api/chat/stream
 *   Body: { provider, messages, tools, toolChoice }
 *   Returns: text/event-stream — each event is a JSON-serialised AgentStreamChunk
 *   Terminal event: data: [DONE]
 */

import { readBody, send } from '../../lib/http.js';
import * as chatService from '../../services/chat.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('chat-route');

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/chat — non-streaming
 * Returns the full AgentTurnResponse once the model finishes.
 */
export async function handleChatAsync(req, res) {
  const body = await readBody(req);
  const { provider: providerName = 'doubao', model, messages, tools = [], toolChoice = 'auto', systemPrompt } = body;

  log.info('→ POST /api/chat', { provider: providerName, model, messages: messages?.length ?? 0, tools: tools.length });

  try {
    const result = await chatService.callAsyncWithLogging({
      provider: providerName,
      model,
      messages,
      tools,
      toolChoice,
      systemPrompt,
      signal: req.signal,
    });
    log.ok('← 200', { toolCalls: result.toolCalls?.length ?? 0, textLen: result.text?.length ?? 0 });
    return send(res, 200, result);
  } catch (err) {
    log.error('← 502', err.message);
    return send(res, 502, { error: err.message });
  }
}

/**
 * POST /api/chat/stream — streaming SSE proxy
 *
 * Opens an SSE connection and forwards AgentStreamChunk events to the client
 * as they arrive from the upstream AI provider.  Aborts the upstream request
 * automatically when the client disconnects.
 */
export async function handleChatStream(req, res) {
  const body = await readBody(req);
  const { provider: providerName = 'doubao', model, messages, tools = [], toolChoice = 'auto', systemPrompt } = body;

  log.info('→ POST /api/chat/stream', { provider: providerName, model, messages: messages?.length ?? 0, tools: tools.length });

  // Abort the upstream AI request when the browser closes the connection
  const abortController = new AbortController();
  req.on('close', () => {
    if (!abortController.signal.aborted) {
      log.debug('client disconnected — aborting upstream');
      abortController.abort();
    }
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  /** Emit one AgentStreamChunk event to the client. */
  const emit = (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);

  let collectedText = '';
  let collectedToolCalls = [];

  try {
    const result = await chatService.callStreamWithLogging({
      provider: providerName,
      model,
      messages,
      tools,
      toolChoice,
      systemPrompt,
      signal: abortController.signal,
      onText: (delta) => { collectedText += delta; emit({ type: 'text', delta }); },
      onThinking: (delta) => emit({ type: 'thinking', delta }),
    });

    // Emit tool_call events (already converted by the service)
    for (const tc of result.toolCalls) {
      collectedToolCalls.push(tc);
      emit({ type: 'tool_call', call: tc });
    }

    if (result.usage) emit({ type: 'usage', usage: result.usage });

    log.ok('stream done', { toolCalls: result.toolCalls.length });
    res.write('data: [DONE]\n\n');
  } catch (err) {
    if (!abortController.signal.aborted) {
      log.error('stream error', err.message);
      emit({ type: 'text', delta: `[Error: ${err.message}]` });
    }
  } finally {
    res.end();
  }
}
