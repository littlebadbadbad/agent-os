/**
 * agent-UI/transport/chatTransport.ts — Chat communication transport
 *
 * PURE DELEGATION LAYER — delegates to the super built-in "chat" plugin.
 *
 * The actual HTTP/IPC transport logic lives in PluginApiClient
 * (agent-UI/plugin/apiClient.ts).  This module is kept for backward
 * compat — consumers get the same interface without any direct fetch(),
 * electronAPI.invoke(), or SSE parsing.
 *
 * Chat streaming now uses PluginApiClient.connectStream() which handles:
 *   - HTTP mode:  WebSocket → pluginRouter.matchWsPath
 *   - IPC mode:   pluginRouter IPC channel → event.sender.send()
 *
 * Both transport paths are completely transparent to the consumer.
 */

import type { AgentTurnResponse, AgentStreamChunk } from '@agent-type';
import { sendAsync, sendStream } from '../plugin/core/chat';
import type { ChatParams } from '../plugin/core/chat';

// Re-export for convenience — consumers get the same functions/types
// without needing to know about plugin/core/ internals.
export { sendAsync, sendStream };
export type { ChatParams };

/**
 * Backward-compat ChatTransport interface.
 * Consumers can type-check against this without importing plugin internals.
 */
export interface ChatTransport {
  sendAsync(params: ChatParams): Promise<AgentTurnResponse>;
  sendStream(params: ChatParams): ReadableStream<AgentStreamChunk>;
}

export const chatTransport: ChatTransport = {
  sendAsync: (params) => sendAsync(params),
  sendStream: (params) => sendStream(params),
};
