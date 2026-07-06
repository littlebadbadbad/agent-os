import pkg from '../package.json';

export const VERSION = pkg.version;

// ── Client ────────────────────────────────────────────────────────────────────
export { createAgentClient } from './client';
export type { DefaultRenderUIConfig } from '../agent-UI/defaultRenderUI';
export type { AgentClientConfig, AgentClient, ToolStateEntry } from './client';
export {
  createToolStateToolSet,
  isToolStateToolSet,
} from './tools/toolStateToolSet';
export type { ToolStateToolSet, ToolStateControl } from './tools/toolStateToolSet';
export { createAgentSession } from './client/agentSession';
export type { AgentSession, AgentSessionState, AgentSessionConfig } from './client/agentSession';
export type {
  SessionManager,
  SessionEntryData,
  SessionListEntry,
  SessionManagerState,
} from './client/sessionManager.types';

// ── Tool primitives ───────────────────────────────────────────────────────────
export { createTodoTools } from './tools/todo';
export { createPlanToolSet } from './tools/plan/toolSet';
export { createToolSearchToolSet } from './tools/toolSearch';
export { createExperienceTools } from './tools/experience/experience';
export type { ExperienceItem, ExperienceInput, ExperienceStore } from './tools/experience/experience';
export type { ToolSet, ToolSetState, ToolSetContext, ToolSetStateContext, AgentQueryFns, AgentClientLike, ToolContextPatch, SystemPromptContext, CompactionResult, CompactionNotice } from '@agent-type';
export { MAIN_CONVERSATION_ID, toolSetContextKey } from './tools/toolSet';
export { createFileTools, createFileToolSet } from './tools/file';
export type {
  FileAdapter,
  HttpFileAdapterConfig,
  ReadFileResult,
  WriteFileResult,
  StrReplaceResult,
  ReplaceAllResult,
  DeleteFileResult,
  MoveFileResult,
  DirEntry,
  ListDirResult,
  SearchFilesResult,
  SearchMatch,
  WorkspaceRootResult,
} from './tools/file';
export { defaultHttpFileAdapter as createHttpFileAdapter } from './tools/file';
export { createIpcFileAdapter } from './tools/file';
export type { IpcFileAdapterConfig } from './tools/file';
export { defineSkill } from './tools/skill';
export type { Skill, SkillState } from './tools/skill';
export {
  toOpenAIMessages,
  toAnthropicMessages,
  toGeminiMessages,
} from './tools/messages';
export type {
  TodoItem,
  TodoStatus,
  TodoPriority,
} from './tools/todo';
export {
  runAgentLoop,
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

// ── Dynamic tool management ───────────────────────────────────────────────────
export { createDynamicToolset, createHttpDynamicToolAdapter, createIpcDynamicToolAdapter } from './tools/dynamicTool';
export type {
  DynamicToolRuntime,
  DynamicToolEntry,
  DynamicToolAdapter,
  HttpDynamicToolAdapterConfig,
  IpcDynamicToolAdapterConfig,
} from './tools/dynamicTool';

// ── Skill management ──────────────────────────────────────────────────────────
export { createSkillToolset, createHttpSkillAdapter, createIpcSkillAdapter } from './tools/skillManager';
export type {
  SkillToolset,
  BackendSkill,
  SkillManagerAdapter,
  HttpSkillAdapterConfig,
  IpcSkillAdapterConfig,
} from './tools/skillManager';

// ── MCP server management ─────────────────────────────────────────────────────
export { createMcpToolset, createHttpMcpAdapter, createIpcMcpAdapter } from './tools/mcp';
export type {
  McpTransport,
  McpServerStatus,
  McpToolDef,
  McpServerEntry,
  McpAdapter,
  HttpMcpAdapterConfig,
  IpcMcpAdapterConfig,
  McpStore,
  McpToolset,
} from './tools/mcp';

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

// ── Upgrade management ────────────────────────────────────────────────────────
export {
  createUpgradeToolSet,
  createHttpUpgradeAdapter,
  createIpcUpgradeAdapter,
  defaultBrowserConfirm,
  defaultTerminalConfirm,
  autoConfirm,
} from './tools/upgrade';
export type {
  UpgradeOptions,
  UpgradeAdapter,
  VersionInfo,
  BuildResult,
  UpgradeConfirmFn,
  HttpUpgradeAdapterConfig,
  IpcUpgradeAdapterConfig,
} from './tools/upgrade';

// ── Terminal management ───────────────────────────────────────────────────────
export { createHttpTerminalAdapter, createIpcTerminalAdapter, createTerminalTools, createTerminalToolSet } from './tools/terminal';
export type {
  TerminalEntry,
  TerminalOutput,
  TerminalManagerAdapter,
  HttpTerminalAdapterConfig,
  IpcTerminalAdapterConfig,
  AvailableShell,
  ShellFamily,
  TerminalToolSet,
} from './tools/terminal';

// ── Cron job scheduling ───────────────────────────────────────────────────────
export { createHttpCronAdapter, createIpcCronAdapter, createCronToolSet } from './tools/cron';
export type {
  CronJob,
  CronStatus,
  CronManagerAdapter,
  HttpCronAdapterConfig,
  IpcCronAdapterConfig,
} from './tools/cron';

// ── Token tracking & summarization ────────────────────────────────────────────
export { createTokenTracker } from './tools/track/tokenTracker';
export type {
  TokenBudgetConfig,
  TokenBudgetState,
  TokenBudgetCallbacks,
  TokenTracker,
} from './tools/track/tokenTracker';
export { createTokenBudgetToolSet } from './tools/track';
export type { TokenBudgetToolSetOptions } from './tools/track';
export { createMemoryGraphToolSet } from './tools/memoryGraph';
export type {
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeGraph,
  SerializedMemoryGraph,
  MemoryGraphState,
  MemoryGraphToolSetOptions,
} from './tools/memoryGraph';
export { summarizeHistory, estimateTokens } from './tools/track/summarize';
export type { SummarizeConfig } from './tools/track/summarize';
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

// ── Git management ───────────────────────────────────────────────────────────
export { createGitToolSet, createHttpGitAdapter, createIpcGitAdapter } from './tools/git';
export type {
  GitAdapter,
  GitFileEntry,
  GitStatusResult,
  GitDiffResult,
  GitLogEntry,
  GitCommitResult,
  HttpGitAdapterConfig,
  IpcGitAdapterConfig,
} from './tools/git';
