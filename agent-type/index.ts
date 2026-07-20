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
  SessionStateLike,
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
  UserInputRequest,
  UserInputMode,
} from "./core";
export { DETACHED_SENTINEL } from "./core";

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
  SessionReadyHelpers,
} from "./toolset";

// Runtime constants & helpers (shared between core and extensions)
export { MAIN_CONVERSATION_ID, ctxKey as ctxKey } from "./toolset";

// ── Widget types ──────────────────────────────────────────────────────────────
export type {
  Position,
  WidgetIcon,
  WidgetTheme,
  WidgetHandler,
} from "./widget";

// ── Plugin types ──────────────────────────────────────────────────────────────
export type {
  Logger,
  PluginManifest,
  PluginState,
  PluginMethod,
  BackendPluginHost,
  AgentPluginHost,
  SlotSession,
  UiPluginHost,
  UiPluginHostInternal,
  ToolCallStatus,
  ToolCallInfo,
  ToolCardDescriptor,
  ToolCardRenderContext,
  StreamHandler,
  StreamConnection,
  PluginStreamClient,
  StreamSubscription,
  PluginApiClient,
  ActivatedBackendPlugin,
  PluginActivateFunction,
} from "./plugin";

// ── UI Slot types (plugin injection points) ───────────────────────────────────
export type {
  ToolButtonSlotDeclaration,
  AutocompleteSlotDeclaration,
  AutocompleteItem,
  SlotType,
  InlineSlotType,
  IframeSlotType,
  IframeConfig,
  PanelSlotDeclaration,
  ToolCardSlotDeclaration,
  CompactToolCardSlotDeclaration,
  CompactToolCardDescriptor,
  InlinePromptSlotDeclaration,
  HeaderBarSlotDeclaration,
  InlineSlotDeclaration,
  IframeSlotDeclaration,
  PluginSlotDeclaration,
  SlotContext,
  SlotDisplayContext,
  PanelHostMessage,
  ToolCardHostMessage,
  InlinePromptHostMessage,
  HeaderBarHostMessage,
  SlotHostMessage,
  FilterSlots,
} from "./ui-slot";

// ── Tool definition helpers (runtime) ────────────────────────────────────────
export {
  defineTool,
  buildTool,
  TOOL_DEFAULTS,
  resolveToolSetTools,
} from "./defineTool";
export type { ToolDef } from "./defineTool";

// ── Model metadata ────────────────────────────────────────────────────────────
export type { ModelMeta } from "./model";

// ── IPC channels (type-safe channel name registry) ───────────────────────────
export type { IpcChannel } from "./ipc-channels";
export { typedInvoke } from "./ipc-channels";
