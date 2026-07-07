/**
 * backend/transports/ipc/chat.js — Chat IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 *
 * Channels:
 *   chat:async        – Non-streaming chat. Calls service, returns result.
 *   chat:stream:start – Start streaming. Pushes events to renderer via
 *                       event.sender.send() until done or aborted.
 *   chat:stream:stop  – Abort an in-flight streaming session.
 *
 * Stream-state registry shared via streamRegistry from lib/.
 */

import * as chatService from '../../services/chat.js';
import { streamRegistry } from '../../lib/stream-registry.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('ipc-chat');

/**
 * Register chat IPC handlers on the given ipcMain instance.
 * @param {import('electron').IpcMain} ipcMain
 */
export function registerChatHandlers(ipcMain) {
  // ── Async (non-streaming) ─────────────────────────────────────────────────
  ipcMain.handle('chat:async', async (_event, params) => {
    const { provider: providerName, model, messages, tools, toolChoice, systemPrompt, signal: _signal } = params ?? {};
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

  // ── Stream: start ─────────────────────────────────────────────────────────
  ipcMain.handle('chat:stream:start', (event, params) => {
    const { provider: providerName, model, messages, tools, toolChoice, systemPrompt } = params ?? {};
    log.info('→ chat:stream:start', { provider: providerName, model, messages: messages?.length ?? 0 });

    const win = event.sender;

    // Build Electron-specific callbacks — these are transport wiring,
    // not business logic.
    //
    // CHANNEL ISOLATION: Each streaming session gets its own IPC channel
    // namespace (`chat:stream:<sessionId>:*`) so parallel streams (e.g.
    // main agent + sub-agent chat simultaneously) never cross-talk.
    // This mirrors the plugin stream pattern (`plugin:<id>:<name>:frame`).
    const { sessionId, abortController } = chatService.startChatStreamingSession({
      provider: providerName,
      model,
      messages,
      tools,
      toolChoice,
      systemPrompt,
      onText: (delta) => { if (!win.isDestroyed()) win.send(`chat:stream:${sessionId}:chunk`, { type: 'text', delta }); },
      onThinking: (delta) => { if (!win.isDestroyed()) win.send(`chat:stream:${sessionId}:chunk`, { type: 'thinking', delta }); },
      onToolCall: (tc) => { if (!win.isDestroyed()) win.send(`chat:stream:${sessionId}:chunk`, { type: 'tool_call', call: tc }); },
      onUsage: (usage) => { if (!win.isDestroyed()) win.send(`chat:stream:${sessionId}:chunk`, { type: 'usage', usage }); },
      onDone: (result) => {
        if (!win.isDestroyed()) win.send(`chat:stream:${sessionId}:done`, result);
      },
      onError: (error) => {
        if (!win.isDestroyed()) win.send(`chat:stream:${sessionId}:error`, { error });
      },
    });

    streamRegistry.set(sessionId, { tag: 'chat', ctrl: abortController, aborted: false });
    log.info('→ chat:stream:start', { sessionId });
    return { sessionId };
  });

  // ── Stream: stop ──────────────────────────────────────────────────────────
  ipcMain.handle('chat:stream:stop', async (_event, params) => {
    const { sessionId } = params ?? {};
    if (sessionId) {
      streamRegistry.abort(sessionId);
      log.info('← chat:stream:stop — aborted', { sessionId });
    }
    return { ok: true };
  });
}
