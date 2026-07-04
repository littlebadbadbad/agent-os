// ═══════════════════════════════════════════════════════════════════════════════
//  @agent-type  —  Plugin development type contract layer
//
//  This is the barrel export for the entire agent-type package.
//  Plugin authors should `import type { ... } from '@agent-type'`.
//  All exports here are pure types/interfaces — zero runtime code.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Core tool primitives ──────────────────────────────────────────────────────
export type {
  Tool,
  ToolField,
  ToolDescriptor,
  ToolCall,
  ToolResult,
  ToolExecutionContext,
  ToolExecutionContextExtension,
  AgentSessionState,
  AgentSessionExtension,
  SessionEntryExtension,
  SessionEntryDataBase,
  SessionEntryData,
  Attachment,
  AttachmentKind,
  DataAttachment,
  UrlAttachment,
  AnyRecord,
  TokenUsage,
  // Stream & response types
  AgentTextChunk,
  AgentThinkingChunk,
  AgentToolCallChunk,
  AgentToolResultChunk,
  AgentAttachmentChunk,
  AgentUsageChunk,
  AgentStreamChunk,
  AgentTurnResponse,
  PluginStateExtension,
} from "./core";

// ── Handler types ─────────────────────────────────────────────────────────────
export type { HandlerContext, AgentHandler } from "./handler";

// ── Message types ─────────────────────────────────────────────────────────────
export type {
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  AgentMessage,
  ToolChoice,
} from "./message";

// ── Vendor wire format types ──────────────────────────────────────────────────
export type {
  OpenAIToolParam,
  AnthropicToolParam,
  GeminiFunctionDeclaration,
  OpenAIContentPart,
  OpenAIMessage,
  AnthropicContentBlock,
  AnthropicMessage,
  GeminiPart,
  GeminiContent,
} from "./vendor";

// ── ToolSet types ─────────────────────────────────────────────────────────────
export type {
  ToolSet,
  ToolSetState,
  ToolSetContext,
  ToolSetStateContext,
  AgentQueryFns,
  AgentClientLike,
  ToolContextPatch,
  SystemPromptContext,
  CompactionResult,
  CompactionNotice,
  AgentRunOutcome,
  SectionId,
} from "./toolset";

// ── Widget types ──────────────────────────────────────────────────────────────
export type {
  Position,
  WidgetIcon,
  WidgetTheme,
  WidgetHandler,
} from "./widget";

// ── Plugin types (new) ────────────────────────────────────────────────────────
export type {
  PluginManifest,
  PluginState,
  PluginMethod,
  BackendPluginHost,
  AgentPluginHost,
  UiPluginHost,
  PluginRecieveMessage as UapPluginMessage,
  PluginUiAdapter,
  ToolCallStatus,
  ToolCallInfo,
  ToolCardDescriptor,
  ToolCardRenderContext,
  ToolCardRenderer,
  StreamHandler,
  StreamConnection,
  StreamCallbacks,
  StreamSubscription,
  PluginApiClient,
  ActivatedBackendPlugin,
  PluginActivateFunction,
} from "./plugin";

// ── Tool definition helpers (runtime) ────────────────────────────────────────
export {
  defineTool,
  buildTool,
  TOOL_DEFAULTS,
  resolveToolSetTools,
} from "./defineTool";
export type { ToolDef } from "./defineTool";
