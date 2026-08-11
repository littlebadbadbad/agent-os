// ═══════════════════════════════════════════════════════════════════════════════
//  @agent-type  —  App development type contract layer
//
//  This is the barrel export for the entire agent-type package.
//  App authors should `import type { ... } from '@agent-type'`.
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
  AgentErrorChunk,
  AgentStreamChunk,
  AgentTurnResponse,
  AppStateExtension,
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
  SessionReadyHelpers,
} from "./toolset";

// Runtime constants & helpers (shared between core and internal-apps)
export { MAIN_CONVERSATION_ID, ctxKey as ctxKey } from "./toolset";

// ── Widget types ──────────────────────────────────────────────────────────────
export type {
  Position,
  WidgetIcon,
  WidgetTheme,
  WidgetHandler,
} from "./widget";

// ── App Bridge (shared agent↔UI object) ───────────────────────────────────
export type { AppBridge } from "./app-bridge";

// ── App services (inter-app backend communication) ─────────────────────
export type { AppServiceRegistry } from "./app-services";

// ── App types ──────────────────────────────────────────────────────────────
export type {
  Logger,
  AppManifest,
  AppState,
  AppMethod,
  BackendAppHost,
  AgentAppHost,
  SlotSession,
  UiAppHost,
  UiAppHostInternal,
  ToolCallStatus,
  ToolCallInfo,
  ToolCardDescriptor,
  ToolCardRenderContext,
  StreamHandler,
  StreamConnection,
  AppStreamClient,
  StreamSubscription,
  AppApiClient,
  ActivatedBackendApp,
  AppActivateFunction,
} from "./app";

// ── UI Slot types (app injection points) ───────────────────────────────────
export {
  startsWithPrefix,
  inlinePrefix,
} from "./ui-slot/types";
export type {
  ToolButtonSlotDeclaration,
  AutocompleteSlotDeclaration,
  AutocompleteItem,
  AutocompleteTriggerContext,
  AutocompleteTriggerResult,
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
  AppSlotDeclaration,
  SlotDeclaration,
  SlotContext,
  SlotDisplayContext,
  PanelHostMessage,
  ToolCardHostMessage,
  InlinePromptHostMessage,
  HeaderBarHostMessage,
  AppHostMessage,
  SlotHostMessage,
  FilterSlots,
} from "./ui-slot";

// ── Tool definition helpers (runtime) ────────────────────────────────────────
export {
  defineTool,
  buildTool,
  TOOL_DEFAULTS,
  resolveToolSetTools,
  resolveToolField,
  resolveFactory,
} from "./defineTool";
export type { ToolDef } from "./defineTool";

// ── Model metadata ────────────────────────────────────────────────────────────
export type { ModelMeta } from "./model";

// ── IPC channels (type-safe channel name registry) ───────────────────────────
export type { IpcChannel } from "./ipc-channels";
export { typedInvoke } from "./ipc-channels";
