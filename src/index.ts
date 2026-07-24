import pkg from "../package.json";

export const VERSION = pkg.version;

// ── Client ────────────────────────────────────────────────────────────────────
export { createAgentClient } from "./client";
export { isAgentStreamChunk, isAgentTurnResponse } from "./tools";
export type { DefaultRenderUIConfig } from "../agent-UI/defaultRenderUI";
export type { AgentClientConfig, AgentClient } from "./client";
export { createAgentSession } from "./client/agentSession";
export type {
  AgentSession,
  AgentSessionState,
  AgentSessionConfig,
} from "./client/agentSession";
export type {
  SessionManager,
  SessionEntryData,
  SessionListEntry,
  SessionManagerState,
} from "./client/sessionManager.types";

export { MAIN_CONVERSATION_ID, ctxKey } from "./tools/toolSet";
export {
  toOpenAIMessages,
  toAnthropicMessages,
  toGeminiMessages,
} from "./tools/messages";
export {
  createSubAgentToolset,
  createSubAgentRegistry,
} from "./tools/subagent";
export type {
  SubAgentConfig,
  SubAgentResult,
  ConversationMessageEntry,
  SubAgentConversation,
  SubAgentConversationState,
  SubAgentEntrySnapshot,
  SubAgentRegistryState,
  SubAgentRegistry,
  CreateSubAgentRegistryOptions,
} from "./tools/subagent";

// ── History converter ─────────────────────────────────────────────────────────
export { agentMessagesToUI } from "./client/historyConverter";

// ── Structured error types ────────────────────────────────────────────────────
export {
  isAgentError,
  toolNotFoundError,
  toolValidationError,
  toolPermissionError,
  toolExecutionError,
} from "./tools/errors";
export type { AgentError, AgentErrorCode } from "./tools/errors";
