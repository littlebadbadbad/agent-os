import type { z, ZodTypeAny } from "zod";
import type { AgentHandler } from "./handler";
// AgentMessage needed by SessionEntryDataBase; message.ts imports from core.ts
// (Attachment, ToolCall) — circular import type is safe in TypeScript.
import type { AgentMessage } from "./message";
import type { PluginUiAdapter } from "./ui-slot";

// ═══════════════════════════════════════════════════════════════════════════════
//  Attachment types  (来自 src/tools/types/attachment.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Semantic category of an attachment.
 * Drives how the widget renders the item and how vendor formatters encode it.
 */
export type AttachmentKind = "image" | "document" | "audio" | "video";

/**
 * Inline (base64-encoded) attachment — the most portable format.
 * Accepted by OpenAI, Anthropic, and Gemini when the data is under their
 * respective size limits (~20 MB for images, varies per vendor for documents).
 */
export type DataAttachment = {
  /** `'data'` discriminant — use `attachment.source === 'data'` to narrow. */
  readonly source: "data";
  readonly kind: AttachmentKind;
  /** IANA media type, e.g. `'image/png'`, `'application/pdf'`. */
  readonly mimeType: string;
  /** Raw base64-encoded content (no `data:…` prefix). */
  readonly data: string;
  /** Optional display name shown in the UI. */
  readonly name?: string;
  /** Original file size in bytes, for display purposes only. */
  readonly size?: number;
};

/**
 * URL-referenced attachment.
 * Only images are broadly supported via URL across vendors.
 * Anthropic and Gemini support `'url'` source for images; for documents use
 * `DataAttachment` with base64 data.
 */
export type UrlAttachment = {
  readonly source: "url";
  readonly kind: "image";
  readonly url: string;
  readonly name?: string;
};

/** Union of all attachment variants. */
export type Attachment = DataAttachment | UrlAttachment;

// ═══════════════════════════════════════════════════════════════════════════════
//  Utility types  (来自 src/tools/types/index.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shorthand for `Record<string, unknown>`.
 * Used as the default constraint for generic ToolSet entry/state type params.
 */
export type AnyRecord = Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════════════════════
//  Token usage  (来自 src/tools/types/response.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Token usage reported by an AI API after a single turn.
 * Mirrors the `usage` object from OpenAI, Anthropic, and Gemini responses.
 */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Wire types (AI ↔ SDK boundary)  (来自 src/tools/types/core.ts — types only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Vendor-agnostic JSON Schema descriptor — the shape every major AI API
 * requires (OpenAI, Anthropic, Google Gemini, Mistral, Cohere, …).
 * `parameters` follows JSON Schema Draft 7.
 */
export type ToolDescriptor = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
};

/** A single tool invocation as returned by the AI in its response. */
export type ToolCall = {
  /**
   * Unique identifier for this call — preserved from the AI's response and
   * must be echoed back when returning the result (OpenAI `tool_call_id`,
   * Anthropic `id`, Gemini `functionCall` name).
   */
  readonly id: string;
  readonly name: string;
  /** Arguments as parsed from the AI's response — validated before execution. */
  readonly arguments: Record<string, unknown>;
};

/** The result of executing a tool call. */
export type ToolResult = {
  readonly toolCallId: string;
  readonly name: string;
  /** Serialised result value. */
  readonly result: unknown;
  /** Optional multimodal attachments (screenshots, generated images, etc.). */
  readonly attachments?: readonly Attachment[];
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Execution context  (来自 src/tools/types/core.ts — types only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Open extension point for `ToolExecutionContext`.
 *
 * ToolSets that need to inject fields into every tool execution context
 * should augment **this interface** (not `ToolExecutionContext` directly),
 * exactly the same pattern as `SessionEntryExtension`:
 *
 * ```ts
 * // my-plugin/types.ts
 * declare module '@agent-type' {
 *   interface ToolExecutionContextExtension {
 *     readonly myField: string;
 *   }
 * }
 * ```
 */
export interface ToolExecutionContextExtension { }

// ═══════════════════════════════════════════════════════════════════════════════
//  UserInputRequest — built-in type contract
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Describes a user-input request that a tool can issue at runtime.
 *
 * The optional `ephemeral` flag marks a request as transient: it will not be
 * persisted in session snapshots and will not be replayed on page reload.
 */
export type UserInputRequest = {
  readonly ephemeral?: true;
} & (
    | { readonly type: "confirm"; readonly message: string }
    | {
      readonly type: "text";
      readonly message: string;
      readonly placeholder?: string;
      readonly defaultValue?: string;
    }
    | {
      readonly type: "select";
      readonly message: string;
      readonly options: readonly string[];
    }
    | {
      readonly type: "multiSelect";
      readonly message: string;
      readonly options: readonly string[];
      readonly minSelect?: number;
      readonly maxSelect?: number;
    }
    | {
      readonly type: "number";
      readonly message: string;
      readonly placeholder?: string;
      readonly defaultValue?: number;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
    }
  );

// ═══════════════════════════════════════════════════════════════════════════════
//  Extension interfaces for module augmentation
//  (来自 src/client/agentSession.types.ts + src/client/sessionManager.types.ts)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Open extension interface for `AgentSessionState`.
 *
 * ToolSets and consuming projects can contribute extra fields via module
 * augmentation — no changes to the SDK source required:
 *
 * ```ts
 * declare module '@agent-type' {
 *   interface AgentSessionExtension {
 *     myCustomField: string[];
 *   }
 * }
 * ```
 *
 * The extra fields must be supplied by the ToolSet's `onGetState` return value
 * and will be merged into session state by the agent client automatically.
 */
export interface AgentSessionExtension extends Record<string, unknown> {
  [key: ToolSetSymbol]: PluginStateExtension & PluginUiAdapter;
}
/** Minimum discriminant every plugin symbol state must provide. */
export interface PluginStateExtension { }
export type ToolSetSymbol = symbol;
/**
 * Open extension point for ToolSet-specific persisted fields.
 *
 * Each ToolSet that needs to save and restore its own data augments this
 * interface in its own file — the same pattern as `AgentSessionExtension`:
 *
 * ```ts
 * // in myToolSet.ts
 * declare module '@agent-type' {
 *   interface SessionEntryExtension {
 *     myField?: MyType;
 *   }
 * }
 * ```
 *
 * `SessionEntryData` is composed as `SessionEntryDataBase & SessionEntryExtension`,
 * so every augmented field is automatically available everywhere `SessionEntryData`
 * is used — in `onInitSession`, `onBuildSnapshot`, `createSession`, etc.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SessionEntryExtension { }

/**
 * Core (always-present) fields of a serialisable session descriptor.
 * ToolSet-specific fields are contributed via `SessionEntryExtension` module augmentation.
 *
 * @see SessionEntryExtension — augment this interface to add custom fields.
 * @see SessionEntryData — the full type composed from both base + extension.
 */
export type SessionEntryDataBase = {
  readonly id: string;
  readonly title: string;
  /** Conversation history (raw LLM-facing messages) to restore. */
  readonly messages?: readonly AgentMessage[];
  /**
   * Compacted LLM context saved at snapshot time.
   * When absent (old snapshots), `messages` is used for both roles.
   */
  readonly liveHistory?: readonly AgentMessage[];
};

/**
 * Full descriptor for a session — used for initial loading, persistence, and
 * external sync.
 *
 * Core fields live in `SessionEntryDataBase`; ToolSet-specific fields are
 * contributed via `SessionEntryExtension` module augmentation.
 */
export type SessionEntryData = SessionEntryDataBase & SessionEntryExtension;

// ═══════════════════════════════════════════════════════════════════════════════
//  AgentSessionState  (核心字段 — 来自 src/client/agentSession.types.ts)
//  业务字段通过 AgentSessionExtension 的 declare module 重载
// ═══════════════════════════════════════════════════════════════════════════════

export type PluginId = string;

/**
 * Minimal session state shape consumed by slot renderers.
 *
 * Both {@link AgentSessionState} and {@link SubAgentConversationState}
 * are assignable to this interface — it captures only the fields that
 * slot renderers and {@link UiPluginHost.getPluginState} actually read.
 *
 * Unlike `AgentSessionState`, this type does **not** extend
 * `Record<string, unknown>`, so `state.id` / `state.agentName` /
 * `state.conversationId` are typed as `string` without casts.
 *
 * Plugins access their own state slices via the symbol-keyed index
 * signature (`state[symbol]`), which returns `PluginStateExtension &
 * PluginUiAdapter` — the same type as `AgentSessionExtension` provides.
 */
export interface SessionStateLike {
  /** Whether the agent is currently processing a turn. */
  readonly isLoading: boolean;
  /** Unique ID of this session or sub-agent conversation. */
  readonly id: string;
  /** Name of the agent that owns this session/conversation. */
  readonly agentName: string;
  /** ID of the conversation within the session. */
  readonly conversationId: string;
  /**
   * Symbol-keyed plugin state slices.
   * Each registered ToolSet contributes state under its own symbol.
   */
  readonly [key: symbol]: PluginStateExtension & PluginUiAdapter;
}

/**
 * Core session state shape exposed to plugins.
 *
 * Plugins see the standard fields (id, messages, isLoading, title, etc.).
 * Business-specific fields are contributed by the host application via
 * `AgentSessionExtension` module augmentation.
 *
 * @see AgentSessionExtension — augment this interface to add custom fields.
 */
export type AgentSessionState = {
  /** Whether the agent is currently processing a turn. */
  readonly isLoading: boolean;
  /** Unique ID of this session. */
  readonly id: string;
  /**
   * Name of the agent that owns this session.
   *
   * Main agent: the configured `id` or `"main"`.
   * Sub-agent: the registered sub-agent tool name (e.g. `"researcher_agent"`).
   *
   * Plugins use this to distinguish whether a slot is opened by the main
   * agent or a sub-agent's conversation.
   */
  readonly agentName: string;
  /**
   * ID of the conversation this state belongs to.
   *
   * Main agent: `"main"` (MAIN_CONVERSATION_ID).
   * Sub-agent: the conversation's unique ID.
   *
   * Together with `agentName`, this lets plugins identify the exact
   * conversation context a slot is rendering for.
   */
  readonly conversationId: string;
} & AgentSessionExtension;
/** Context passed to the tool's `execute` function on every invocation. */
export interface ToolExecutionContext extends ToolExecutionContextExtension {
  /** Signal to abort long-running tool operations. */
  readonly signal: AbortSignal;
  /**
   * Root session ID — always the ID of the top-level `AgentSession`.
   *
   * **Same for all agents** (main agent and every sub-agent) within one session.
   * This is intentional: tools that access the session-level registry (e.g.
   * `create_*_subagent`) use this to locate the correct registry regardless of
   * which agent is calling them.
   *
   * Do NOT use this to distinguish one agent from another — use `agentName`.
   * For per-agent state derive the key as:
   *   - main agent: `sessionId`
   *   - sub-agent:  `"${sessionId}:${agentName}"`
   */
  readonly sessionId: string;
  /**
   * Name of the agent currently executing this tool call.
   * `'main'` for the root agent; the sub-agent's registered name otherwise.
   * Always a non-empty string — use this to identify the caller.
   */
  readonly agentName: string;
  /**
   * Unique ID of the conversation in which this tool call is executing.
   *
   * - **Main agent**: equals `sessionId` (set in `buildHandlerContext`).
   * - **Sub-agent**: the per-conversation ID (e.g. `"conv-abc-123"`), which
   *   differs from `sessionId`.
   *
   * Use `conversationId !== sessionId` to detect whether the caller is a
   * sub-agent vs. the root agent.
   */
  readonly conversationId: string;
  /**
   * Name of the agent currently executing this tool.
   * `'main'` for the root agent; the sub-agent's registered name otherwise.
   * Use this for attribution in tool cards and debug logging.
   */
  readonly sourceAgent: 'main' | string;
  /**
   * Derived convenience: `true` when this tool is being executed by a
   * sub-agent (i.e. `sourceAgent !== 'main'`).
   */
  readonly isSubAgent: boolean;
  /**
   * The `AgentHandler` driving the current agent session.
   *
   * Available so that tools can make meta-calls to the LLM (e.g. graph
   * extraction, summarisation) without going through a ToolSet-level
   * `handlerRef` indirection.  Always set by the real pipeline; `undefined`
   * only in headless test contexts that construct a bare `ToolExecutionContext`
   * without a pipeline.
   */
  readonly handler?: AgentHandler;
  /**
   * Force-flush any pending debounced persistence write.
   *
   * Tools that perform destructive operations on the host process (the
   * upgrade ToolSet's `restart` is the canonical caller) should `await` this
   * before exiting, otherwise queued session snapshots — most importantly
   * `pendingUserInput` — can be lost.
   *
   * Wired by `wireSessionPersistence` in the AgentClient.  `undefined` when
   * no `onSessionsChange` callback was supplied (no persistence configured)
   * or in headless test contexts.
   */
  readonly flushPersistence?: () => Promise<void>;
  /**
   * Request a value from the user, suspending tool execution until a response
   * arrives. Returns `null` when the user cancels or the `AbortSignal` fires.
   *
   * `undefined` when the user-input plugin is not installed — callers must
   * guard with `?.`.
   *
   * @param id  Optional stable identifier for this request.  Supply a
   *            pre-generated `crypto.randomUUID()` to cancel the prompt
   *            programmatically via `cancelUserInput`.
   */
  readonly requestUserInput?: (
    request: UserInputRequest,
    id?: string,
  ) => Promise<string | null>;
  /**
   * Cancel a pending user-input prompt by its ID.
   * `undefined` when the user-input plugin is not installed.
   */
  readonly cancelUserInput?: (id: string) => void;
}

// ── Resolvable helper ─────────────────────────────────────────────────────────

/** A value-or-predicate that resolves at call time given the tool input. */
export type ToolField<TValue, TSchema extends ZodTypeAny> =
  | TValue
  | ((params: z.infer<TSchema>) => TValue);

// ── Tool definition ───────────────────────────────────────────────────────────

/**
 * A strongly-typed, self-contained tool definition.
 *
 * Parameters are described via a Zod schema, which enables:
 *  - Full TypeScript inference for `execute`
 *  - Automatic JSON Schema generation for any AI vendor API
 *  - Runtime validation of arguments before execution
 *
 * @example
 * ```ts
 * const myTool: Tool<'say_hello', typeof schema> = {
 *   name: 'say_hello',
 *   description: 'Say hello to someone.',
 *   parameters: z.object({ name: z.string() }),
 *   execute: async ({ name }) => `Hello, ${name}!`,
 * };
 * ```
 */
export type Tool<
  TName extends string = string,
  TSchema extends ZodTypeAny = ZodTypeAny,
  TResult = unknown,
> = {
  readonly name: TName;
  readonly description: string | (() => string);
  readonly parameters: TSchema | (() => TSchema);
  readonly rawParametersSchema?:
  | Record<string, unknown>
  | (() => Record<string, unknown>);
  readonly group?: string;
  readonly execute: (
    params: z.infer<TSchema>,
    context: ToolExecutionContext,
  ) => Promise<TResult>;

  readonly isReadOnly?: ToolField<boolean, TSchema>;
  readonly isDestructive?: ToolField<boolean, TSchema>;
  readonly isConcurrencySafe?: ToolField<boolean, TSchema>;
  readonly interruptBehavior?: "cancel" | "block";

  readonly getDescription?: (
    params: z.infer<TSchema>,
    context: ToolExecutionContext,
  ) => Promise<string> | string;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Stream & response types  (来自 src/tools/types/response.ts — types only)
// ═══════════════════════════════════════════════════════════════════════════════

/** A single text delta chunk in a structured stream. */
export type AgentTextChunk = { readonly type: "text"; readonly delta: string };

/** A thinking/reasoning delta chunk emitted before the final response text. */
export type AgentThinkingChunk = {
  readonly type: "thinking";
  readonly delta: string;
};

/** A tool-call chunk in a structured stream. */
export type AgentToolCallChunk = {
  readonly type: "tool_call";
  readonly call: ToolCall;
};

/** A pre-executed tool-call chunk. */
export type AgentToolResultChunk = {
  readonly type: "tool_result";
  readonly call: ToolCall;
  readonly result: ToolResult;
};

/** An attachment chunk in a structured stream. */
export type AgentAttachmentChunk = {
  readonly type: "attachment";
  readonly attachment: Attachment;
};

/** A usage chunk in a structured stream. */
export type AgentUsageChunk = {
  readonly type: "usage";
  readonly usage: TokenUsage;
};

/** Union of all possible chunks in a structured `ReadableStream`. */
export type AgentStreamChunk =
  | AgentTextChunk
  | AgentThinkingChunk
  | AgentToolCallChunk
  | AgentToolResultChunk
  | AgentAttachmentChunk
  | AgentUsageChunk;

/**
 * Non-streaming structured response that can include tool calls.
 */
export type AgentTurnResponse = {
  readonly text: string;
  readonly thinking?: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly usage?: TokenUsage;
};
