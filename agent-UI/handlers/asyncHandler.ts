/**
 * agent-UI/handlers/asyncHandler.ts — Async (non-streaming) backend handler.
 *
 * ⚠️ REFERENCE IMPLEMENTATION ONLY — NOT MOUNTED IN PRODUCTION.
 *
 * The app runs a single agent (streamAgent, see agent-UI/agents.ts) driven by
 * streamHandler.  This handler exists as a working example of an alternative
 * AgentHandler shape (request/response instead of streaming) and is covered by
 * its own unit tests — but it is deliberately NOT wired into the app wiring.
 * Do not register it without also mounting a second agent client, and be aware
 * that sharing one ToolSet instance across two agents requires per-agent state
 * (see internal-plugins/tool-state for the multi-agent pattern).
 *
 * PURE BUSINESS LOGIC — ZERO communication code.
 * Delegates all HTTP/IPC details to the chat transport layer.
 */
import type { AgentHandler } from "@agent-type";
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
    tools,
    toolChoice,
    systemPrompt,
    signal,
  });
};
