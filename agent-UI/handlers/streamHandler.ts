/**
 * agent-UI/handlers/streamHandler.ts — Streaming backend handler.
 *
 * PURE BUSINESS LOGIC — ZERO communication code.
 * Delegates all HTTP/IPC streaming details to the chat transport layer.
 *
 * The transport returns a ReadableStream<AgentStreamChunk> that the SDK
 * widget knows how to drain, regardless of whether the underlying transport
 * is HTTP SSE or Electron IPC push events.
 */
import type { AgentHandler } from '@agent-sdk';
import { providerStore } from '../store/providerStore';
import { chatTransport } from '../transport/chatTransport';

export const streamHandler: AgentHandler = async (messages, {tools, toolChoice, systemPrompt, signal}) => {
  const { modelId: model } = providerStore.getSelection();
  const provider = providerStore.get();

  return chatTransport.sendStream({
    provider,
    model,
    messages,
    tools,
    toolChoice,
    systemPrompt,
    signal,
  });
};
