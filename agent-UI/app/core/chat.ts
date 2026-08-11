/**
 * agent-UI/app/core/chat.ts — Super built-in "chat" app API
 *
 * Typed wrappers for both async and streaming chat.
 * All calls go through AppApiClient (dual HTTP/IPC transport).
 *
 * Async chat → client.call('async', params)
 * Streaming chat → client.connectStream('chatStream', params)
 *
 * No direct fetch(), no electronAPI.invoke(), no SSE parsing —
 * the AppApiClient handles transport selection transparently.
 */

import type { AgentTurnResponse, AgentStreamChunk, AgentMessage, ToolDescriptor, ToolChoice } from '@agent-type';
import { isAgentStreamChunk } from '@agent-sdk';
import { createAppApiClient } from '../apiClient';

const client = createAppApiClient('chat');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatParams {
  provider: string;
  model: string;
  messages: AgentMessage[];
  tools?: readonly ToolDescriptor[];
  toolChoice?: ToolChoice;
  systemPrompt?: string;
  signal?: AbortSignal;
}

// ── Async ─────────────────────────────────────────────────────────────────────

/**
 * Non-streaming chat — returns the full AgentTurnResponse once complete.
 */
export async function sendAsync(params: ChatParams): Promise<AgentTurnResponse> {
  return client.call<AgentTurnResponse>('async', { ...params });
}

// ── Streaming ─────────────────────────────────────────────────────────────────

/**
 * Streaming chat — returns a ReadableStream of AgentStreamChunks.
 *
 * Two-phase protocol:
 *   Phase 1: client.call('streamStart', params) → { sessionId }
 *            Stores the full chat params (messages, tools, etc.) on the server.
 *   Phase 2: client.connectStream('chatStream', { sessionId })
 *            Connects with only a flat sessionId — no complex object serialisation.
 *
 * This avoids JSON-serialising large objects (messages[], tools[]) through
 * the WebSocket URL query string, which caused '[object Object]' bugs.
 *
 * The returned ReadableStream's cancel() method stops the stream.
 */
export function sendStream(params: ChatParams): ReadableStream<AgentStreamChunk> {
  const { signal } = params;

  let subscription: { unsubscribe(): void } | null = null;

  return new ReadableStream<AgentStreamChunk>({
    async start(controller) {
      // Phase 1: register the session with full params (exclude client-only AbortSignal)
      const { sessionId } = await client.call<{ sessionId: string }>('streamStart', {
        provider: params.provider,
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        toolChoice: params.toolChoice,
        systemPrompt: params.systemPrompt,
      });

      // Phase 2: connect with only the session ID
      const streamClient = client.connectStream('chatStream', { sessionId });

      streamClient.callbacks.onData = (chunk) => {
        if (isAgentStreamChunk(chunk)) {
          controller.enqueue(chunk);
        } else {
          console.warn('[chat] Ignoring non-AgentStreamChunk data:', chunk);
        }
      };

      streamClient.callbacks.onEnd = () => {
        subscription?.unsubscribe();
        controller.close();
      };

      streamClient.callbacks.onError = (err) => {
        subscription?.unsubscribe();
        controller.error(err);
      };

      subscription = streamClient.subscribe();

      if (signal) {
        signal.addEventListener('abort', () => {
          client.call('streamStop', { sessionId }).catch(() => {});
          subscription?.unsubscribe();
        }, { once: true });
      }
    },

    cancel() {
      subscription?.unsubscribe();
    },
  });
}
