/**
 * agent-UI/transport/chatTransport.ts — Chat communication transport
 *
 * PURE DELEGATION LAYER — delegates to the super built-in "chat" app.
 *
 * The actual HTTP/IPC transport logic lives in AppApiClient
 * (agent-UI/app/apiClient.ts).  This module is kept for backward
 * compat — consumers get the same interface without any direct fetch(),
 * electronAPI.invoke(), or SSE parsing.
 *
 * Chat streaming now uses AppApiClient.connectStream() which handles:
 *   - HTTP mode:  WebSocket → appRouter.matchWsPath
 *   - IPC mode:   appRouter IPC channel → event.sender.send()
 *
 * Both transport paths are completely transparent to the consumer.
 */

import type { AgentTurnResponse, AgentStreamChunk } from '@agent-type';
import { sendAsync, sendStream } from '../app/core/chat';
import type { ChatParams } from '../app/core/chat';

// Re-export for convenience — consumers get the same functions/types
// without needing to know about app/core/ internals.
export { sendAsync, sendStream };
export type { ChatParams };

/**
 * Backward-compat ChatTransport interface.
 * Consumers can type-check against this without importing app internals.
 */
export interface ChatTransport {
  sendAsync(params: ChatParams): Promise<AgentTurnResponse>;
  sendStream(params: ChatParams): ReadableStream<AgentStreamChunk>;
}

export const chatTransport: ChatTransport = {
  sendAsync: (params) => sendAsync(params),
  sendStream: (params) => sendStream(params),
};
