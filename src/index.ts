import pkg from '../package.json';

export const VERSION = pkg.version;

// ── Client ────────────────────────────────────────────────────────────────────
export { createAgentClient } from './client';
export type { DefaultRenderUIConfig } from '../agent-UI/defaultRenderUI';
export type { AgentClientConfig, AgentClient } from './client';
export { createAgentSession } from './client/agentSession';
export type { AgentSession, AgentSessionState, AgentSessionConfig } from './client/agentSession';
export type {
  SessionManager,
  SessionEntryData,
  SessionListEntry,
  SessionManagerState,
} from './client/sessionManager.types';

// ── Tool primitives ───────────────────────────────────────────────────────────
export { createToolSearchToolSet } from './tools/toolSearch';
export type { ToolSet, ToolSetState, ToolSetContext, ToolSetStateContext, AgentQueryFns, AgentClientLike, ToolContextPatch, SystemPromptContext, CompactionResult, CompactionNotice } from '@agent-type';
export { MAIN_CONVERSATION_ID, ctxKey } from './tools/toolSet';
export {
  toOpenAIMessages,
  toAnthropicMessages,
  toGeminiMessages,
} from './tools/messages';
export {
  createSubAgentToolset,
  createSubAgentRegistry,
  createDelegationNudgeToolSet,
} from './tools/subagent';
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
} from './tools/subagent';
export { createToolResultCompressorToolSet } from './tools/historyProcessing';
export type { ToolResultCompressorOptions } from './tools/historyProcessing';

// ── Permissions ───────────────────────────────────────────────────────────────
export { createPermissionsToolSet } from './tools/permissions';
export type {
  PermissionsToolSetOptions,
  PermissionsAdapter,
  PermissionMode,
  PermissionResult,
  PermissionRules,
  ToolPermissionContext,
} from './tools/permissions';

// ── Token tracking & summarization ────────────────────────────────────────────
export { createMemoryGraphToolSet } from './tools/memoryGraph';
export type {
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeGraph,
  SerializedMemoryGraph,
  MemoryGraphState,
  MemoryGraphToolSetOptions,
} from './tools/memoryGraph';
export type {
  HandlerContext,
  OpenAIToolParam,
  AnthropicToolParam,
  GeminiFunctionDeclaration,
  TokenUsage,
  AttachmentKind,
  DataAttachment,
  UrlAttachment,
  Attachment,
  OpenAIContentPart,
  OpenAIMessage,
  AnthropicContentBlock,
  AnthropicMessage,
  GeminiPart,
  GeminiContent,
  AgentTurnResponse,
  AgentStreamChunk,
  AgentTextChunk,
  AgentThinkingChunk,
  AgentToolCallChunk,
  AgentToolResultChunk,
  AgentAttachmentChunk,
  AgentUsageChunk,
  AgentMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  ToolChoice,
  Tool,
  ToolDescriptor,
  ToolCall,
  ToolResult,
  ToolExecutionContext,
  AgentHandler,
  WidgetIcon,
  WidgetTheme,
} from '@agent-type';
export {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  DRAG_THRESHOLD,
  ANIM_DURATION,
} from './constants';

// ── History converter ─────────────────────────────────────────────────────────
export { agentMessagesToUI } from './client/historyConverter';

// ── Variable store ────────────────────────────────────────────────────────────
export { createVariableToolSet, isVariableHandle, extractHandles } from './tools/variable';
export type {
  VariableToolSetOptions,
  VariableHandle,
  VariableEntry,
  JsonVariable,
  AttachmentVariable,
  Variable,
  JsonValue,
  JsonObject,
  JsonArray,
  JsonPrimitive,
  VariableStore,
  VariableStoreRef,
  SerializedVariable,
} from './tools/variable';

// ── Structured error types ────────────────────────────────────────────────────
export {
  isAgentError,
  toolNotFoundError,
  toolValidationError,
  toolPermissionError,
  toolExecutionError,
} from './tools/errors';
export type { AgentError, AgentErrorCode } from './tools/errors';


