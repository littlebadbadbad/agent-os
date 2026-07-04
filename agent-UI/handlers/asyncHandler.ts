/**
 * agent-UI/handlers/asyncHandler.ts — Async (non-streaming) backend handler.
 *
 * PURE BUSINESS LOGIC — ZERO communication code.
 * Delegates all HTTP/IPC details to the chat transport layer.
 */
import type { AgentHandler, AgentTurnResponse } from "@agent-sdk";
import { providerStore } from "../store/providerStore";
import { chatTransport } from "../transport/chatTransport";

export const asyncHandler: AgentHandler = async (
  messages,
  { tools, toolChoice, systemPrompt, signal },
) => {
  const { modelId: model } = providerStore.getSelection();
  const provider = providerStore.get();

  return chatTransport.sendAsync({
    provider,
    model,
    messages,
    tools: tools as any,
    toolChoice,
    systemPrompt,
    signal,
  }) as Promise<AgentTurnResponse>;
};
