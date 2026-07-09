import type { Tool, TokenUsage, Attachment, ToolResult, ToolExecutionContext, AnyRecord, AgentSessionState, SessionEntryData, SessionEntryExtension, PluginStateExtension } from './core';
import type { AgentMessage } from './message';
import type { AgentHandler } from './handler';
import { PluginUiAdapter } from './plugin';

// ═══════════════════════════════════════════════════════════════════════════════
//  Shared constants & helpers (used by both core and extensions)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sentinel `conversationId` used for the main agent (non-sub-agent) context.
 * Sub-agents always carry their real conversation ID.
 */
export const MAIN_CONVERSATION_ID = "main" as const;

/**
 * Derive the canonical Map key for a `ToolSetContext`.
 *
 * - Main agent:  `sessionId`
 * - Sub-agent:   `"${sessionId}:${agentName}"`
 *
 * This matches the key format used before `ToolSetContext` was introduced,
 * so persisted data (e.g. toolStates) remains compatible.
 */
export function ctxKey(ctx: ToolSetContext): string {
  return ctx.conversationId === MAIN_CONVERSATION_ID
    ? ctx.sessionId
    : `${ctx.sessionId}:${ctx.agentName}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ToolSet types  (来自 src/tools/toolSet.ts — types only)
// ═══════════════════════════════════════════════════════════════════════════════

// ── AgentClientLike ───────────────────────────────────────────────────────────

/**
 * Read-only query surface passed to `onAttach` for ToolSets that only need to
 * inspect the agent (e.g. sub-agent meta-tools).
 *
 * Deliberately kept to the minimum needed for description generation and
 * sub-agent delegation — no mutating registration methods.
 */
export type AgentQueryFns = {
  /** All master tools (unfiltered). */
  getTools(): readonly Tool[];
  /** Tools after applying all `onFilterTools` hooks for the active session. */
  getFilteredTools(): readonly Tool[];
  /** All ToolSets currently registered on this agent (config-time + runtime). */
  getRegisteredToolSets(): readonly ToolSet[];
  /** The AgentHandler driving this agent's sessions. */
  handler: AgentHandler;
};

/**
 * Full agent interface exposed to ToolSets that need to mutate the agent
 * (e.g. dynamic-tool and skill-manager toolsets that call `registerTool` inside
 * `onAttach` to inject proxies/skill tools).
 *
 * The full `AgentClient` type satisfies this interface — no casting required.
 */
export type AgentClientLike = AgentQueryFns & {
  /** Register a single tool on the agent (and all existing sessions). */
  registerTool(t: Tool): () => void;
  /** Register a ToolSet on the agent (and all existing sessions). */
  registerToolSet(ts: ToolSet): () => void;
};

// ── ToolSet invocation context ────────────────────────────────────────────────

/**
 * Rich context object passed as the first argument to every ToolSet lifecycle
 * hook — analogous to `ToolExecutionContext` for tool `execute` functions.
 *
 * All three fields are always present:
 * - **sessionId** — the root (main-agent) session identifier, stable for the
 *   entire session lifetime.
 * - **agentName** — the agent's configured `id` for the main agent, or the
 *   sub-agent's `name` for sub-agents.
 * - **conversationId** — `MAIN_CONVERSATION_ID` for main-agent turns; the
 *   actual conversation ID for sub-agent turns.
 *
 * ToolSet implementations should use `ctxKey(ctx)` when they need
 * a single string to key their internal per-scope Maps, preserving backward-
 * compatible key semantics across main agents and sub-agents.
 */
export type ToolSetContext = {
  readonly sessionId: string;
  readonly agentName: string;
  readonly conversationId: string;
};

// ── ToolSet state context ─────────────────────────────────────────────────────

/**
 * Context passed to `onGetState` so ToolSets can derive state from the current
 * tool list without needing direct access to the tool manager.
 */
export type ToolSetStateContext = {
  /** All registered tools for the session at the time of the call. */
  readonly tools: readonly Tool[];
  /**
   * The session state snapshot immediately before this toolset's contribution
   * is merged in.  Toolsets that need to patch existing state fields (e.g.
   * inserting messages into the chat history) can read the current value here
   * and return a modified version.
   *
   * `undefined` during the initial state construction (before any session state
   * exists).
   */
  readonly prevState?: AgentSessionState;
};

// ── Tool context patch ────────────────────────────────────────────────────────

/**
 * A callable that patches `ToolExecutionContext` for every tool call in a
 * session, optionally carrying a human-readable `comment` that describes
 * what it injects.
 *
 * The `comment` field is read by `createDynamicToolset` to inform the AI
 * about context fields available inside frontend tool implementations.
 * Write it as a compact Markdown snippet — one line per injected field,
 * with type signature and a short purpose note.
 *
 * @example
 * ```ts
 * onPatchToolContext: Object.assign(
 *   (ctx, signal) => ({ myField: buildValue(ctx) }),
 *   { comment: '`context.myField` — the computed value for this session.' },
 * ),
 * ```
 */
export interface ToolContextPatch {
  (ctx: ToolSetContext, signal: AbortSignal): Partial<ToolExecutionContext> | undefined;
  /** Markdown description of the ToolExecutionContext fields this patch injects. */
  comment?: string;
}

// ── System-prompt context ─────────────────────────────────────────────────────

/**
 * Rich context passed to `onGetSystemPrompt` for each LLM invocation.
 *
 * Gives ToolSets full visibility into the prompt state at the moment they are
 * called — enabling conditional injection, deduplication, and cross-ToolSet
 * awareness without any shared mutable state.
 */
export type SystemPromptContext = {
  /**
   * The raw user message text for this agent run, or `undefined` when called
   * programmatically (no UI input).
   */
  userMessage: string | undefined;
  /**
   * The agent's configured base system prompt, before any ToolSet injections.
   * `undefined` when the agent was created without a base system prompt.
   */
  baseSystemPrompt: string | undefined;
  /**
   * All prompt parts accumulated so far — the base system prompt (if any)
   * followed by every fragment injected by ToolSets that ran before this one,
   * in order.
   *
   * The final system prompt sent to the model is `parts.join('\n\n')`. Use
   * this array to inspect, deduplicate, or conditionally extend the prompt
   * without re-parsing a pre-joined string.
   */
  currentSystemPromptParts: readonly string[];

  /**
   * Mark another ToolSet's system-prompt fragment for suppression.
   *
   * When called, the base layer will **still execute** the target ToolSet's
   * `onGetSystemPrompt` hook (so the ToolSet can perform side-effects or
   * internal bookkeeping), but the returned fragment will be **discarded**
   * and not included in the final system prompt sent to the model.
   *
   * **Access control**: only ToolSets that carry the
   * `TOOL_STATE_TOOLSET_BRAND` (defined in the base layer's `toolSet.ts`)
   * receive a functional callback.  All other ToolSets get a no-op —
   * preventing arbitrary ToolSets from suppressing each other's prompts.
   * Currently only `ToolStateToolSet` satisfies this check.
   *
   * This is the mechanism used by `ToolStateToolSet` to suppress the prompt
   * of a ToolSet whose tools are all disabled — the base layer itself has no
   * knowledge of tool-enable/disable state.
   *
   * @param toolSetName The `name` of the ToolSet whose prompt should be
   *                   suppressed.  No-op if the name does not match any
   *                   registered ToolSet.
   */
  suppressToolSetPrompt: (toolSetName: string) => void;
};

// ── Compaction ────────────────────────────────────────────────────────────────

/**
 * A UI-facing notice emitted by a ToolSet when it compacts history.
 *
 * The session layer renders each notice as an info-style assistant message.
 * ToolSets own the content entirely — they may include Markdown text, rich
 * attachments (e.g. a token-usage chart), or any other displayable payload.
 */
export type CompactionNotice = {
  /** Markdown string shown in the chat UI. */
  content: string;
  /** Optional rich attachments (images, charts, diffs, …). */
  attachments?: readonly Attachment[];
};

/**
 * Returned by `ToolSet.onAfterTurn` when the hook has compacted the history
 * (e.g. via summarisation).
 *
 * The session layer:
 * - Replaces its LLM-facing history with `history`.
 * - Renders each entry in `notices` as an info-style assistant message in the
 *   UI.  ToolSets are responsible for composing these messages; the session
 *   layer is a pure renderer with no knowledge of their semantics.
 */
export type CompactionResult = {
  /** The compacted message history to replace the current one. */
  history: AgentMessage[];
  /**
   * Zero or more UI notices to display after compaction.
   * Each ToolSet appends its own notices; the session layer renders them all.
   */
  notices?: readonly CompactionNotice[];
};

// ── Agent-run outcome ─────────────────────────────────────────────────────────

/**
 * Describes how an agent run concluded.  Passed to `ToolSet.onAfterRun` so
 * hooks can decide whether and how to react when the loop ends.
 *
 * - `'completed'`  — the model stopped calling tools naturally.
 * - `'max-turns'`  — the configured `maxAgentTurns` limit was reached.
 * - `'aborted'`    — the run was cancelled by the user or a signal.
 * - `'error'`      — an unexpected exception was thrown inside the loop.
 */
export type AgentRunOutcome = 'completed' | 'max-turns' | 'aborted' | 'error';

// ── Intercept result ───────────────────────────────────────────────────────────

/**
 * Returned by {@link ToolSet.onInterceptMessage} when the ToolSet has handled
 * the message itself (e.g. queued it for later delivery).  When any ToolSet
 * returns `{ intercepted: true }`, the sendMessage call stops — the message
 * is not delivered to the agent.
 *
 * Return `void` / `undefined` to let other ToolSets try, or to let the
 * message pass through to the normal send path.
 */
export type InterceptResult = { readonly intercepted: true } | void;

// ── State ──────────────────────────────────────────────────────────────────────

/**
 * The portion of agent session state that a ToolSet can contribute.
 * Fields are merged into the live session state and surfaced to the widget UI.
 *
 * This is an open-ended record; each ToolSet adds its own keys (e.g.
 * `subAgentRegistries`) which the SDK merges into the session state object.
 */
export type ToolSetState = Partial<AgentSessionState>;

// ── Section identifier ────────────────────────────────────────────────────────

/**
 * System-prompt section identifier for ordering and deduplication.
 *
 * When multiple ToolSets register the same section ID, only the one
 * with the lowest `sectionPriority` is included in the final prompt —
 * the others are skipped.  ToolSets without a `sectionId` are always
 * included (no deduplication applied).
 *
 * Sections are injected in ascending `sectionPriority` order.  For the
 * canonical list of known section IDs and their recommended priority
 * ranges, see `SECTION_IDS` in `prompts/section.ts`.
 *
 * ToolSets that do NOT set `sectionId` are **not sorted** and are
 * **never deduplicated** — they always inject their prompt fragment
 * unconditionally, preserving backward compatibility.
 *
 * @default undefined (no section association — unconditional injection)
 */
export type SectionId = string;

// ── ToolSet ────────────────────────────────────────────────────────────────────

/**
 * A ToolSet bundles related tools with agent lifecycle hooks.
 *
 * Register via `createAgentClient({ toolSets: [myToolSet] })` or dynamically
 * via `agent.registerToolSet(ts)`.  The SDK will:
 * - Register all resolved `tools` into every session automatically.
 * - Call lifecycle hooks as sessions are created, reset, and destroyed.
 * - Merge `onGetState` contributions into the session's `AgentSessionState`.
 * - Inject `onGetSystemPrompt` return values into every handler turn's system prompt.
 * - Call `onBuildSnapshot` when serialising a session for persistence.
 */
export type ToolSet = {
  symbol?: symbol;
  /** Human-readable name (used for debugging / deduplication). */
  name: string;
  /**
   * Optional one-line description of this ToolSet's domain or purpose.
   *
   * Used by `createDynamicToolset` to label the ToolSet's context
   * contributions in the system prompt it injects.
   */
  description?: string;

  /**
   * System-prompt section identifier for ordering and deduplication.
   *
   * When multiple ToolSets register the same section ID, only the one
   * with the lowest `sectionPriority` is included in the final prompt —
   * the others are skipped.  ToolSets without a `sectionId` are always
   * included (no deduplication applied).
   *
   * Sections are injected in ascending `sectionPriority` order.  For the
   * canonical list of known section IDs and their recommended priority
   * ranges, see `SECTION_IDS` in `prompts/section.ts`.
   *
   * ToolSets that do NOT set `sectionId` are **not sorted** and are
   * **never deduplicated** — they always inject their prompt fragment
   * unconditionally, preserving backward compatibility.
   *
   * @default undefined (no section association — unconditional injection)
   */
  sectionId?: SectionId;

  /**
   * Sort priority within the system prompt.  Lower values appear first.
   * Only meaningful when `sectionId` is also set.
   *
   * @default 100
   */
  sectionPriority?: number;

  /**
   * Tools to register in every session.
   *
   * Accepts either a static array or a factory function — use the factory form
   * for ToolSets whose tool list is determined lazily (e.g. tools resolved
   * asynchronously after `onAttach`).
   */
  tools: readonly Tool[] | (() => readonly Tool[]);

  /**
   * Names of this ToolSet's tools that must always remain visible to the model,
   * even when `createToolSearchToolSet` defers the rest behind `tool_search`.
   *
   * Declare the tools that the agent needs to *discover* or *initiate* a
   * workflow — once inside a mode (e.g. plan mode) the ToolSet's own
   * `onFilterTools` controls visibility independently.
   *
   * `createToolSearchToolSet` aggregates `coreTools` from every registered
   * ToolSet at filter time, so new ToolSets registered dynamically are also
   * respected without any manual bookkeeping.
   */
  coreTools?: readonly string[];

  // ── Agent attachment ───────────────────────────────────────────────────────

  /**
   * Called once per agent the ToolSet is registered on, immediately after
   * `agent.registerToolSet(ts)` completes.
   *
   * Use to capture the agent reference for callbacks that need live access to
   * the tool list, handler, or other ToolSets at execution time (e.g.
   * dynamic-tool and skill-manager ToolSets call `registerTool` here to inject
   * proxy tools).
   *
   * For ToolSets registered on multiple agents, `onAttach` fires once per
   * agent attachment — collect references accordingly.
   *
   * The optional returned function is invoked when the ToolSet is unregistered
   * from that agent, allowing agent-specific cleanup.
   */
  onAttach?(agent: AgentQueryFns): (() => void) | void;

  // ── Session lifecycle ──────────────────────────────────────────────────────

  /**
   * Called once when a session is created or restored.
   *
   * Use to initialise or rehydrate per-session state from the persisted
   * `entryData`.  Fired for both main-agent sessions and sub-agent scopes
   * (keyed by `ctxKey(ctx)`).
   *
   * The `entryData` includes all core fields (`id`, `title`, `messages`,
   * `liveHistory`) plus any ToolSet-contributed fields from the
   * `SessionEntryExtension` module augmentation.
   */
  onInitSession?(ctx: ToolSetContext, entryData: SessionEntryData): void;
  /**
   * Called once after `onInitSession`, when the session's `sendMessage`
   * function is available.
   *
   * Use for post-creation wiring that requires the ability to send messages —
   * e.g. forwarding ghost-restored pending user-input answers as fresh agent
   * turns.
   */
  onSessionReady?(ctx: ToolSetContext, sendMessage: (text: string) => void): void;
  /**
   * Called when the session's history is cleared (user pressed "Clear chat").
   * Use to reset per-session state alongside the message history.
   */
  onResetSession?(ctx: ToolSetContext): void;
  /**
   * Called when a session is permanently removed.
   * Use to release per-session state and subscriptions.
   */
  onRemoveSession?(ctx: ToolSetContext): void;

  // ── Sub-agent conversation lifecycle ──────────────────────────────────────

  /**
   * Called once per sub-agent conversation when it is created.
   *
   * Fired for every new conversation, including the first one created with a
   * new sub-agent.  NOT called for main-agent sessions — use `onInitSession`.
   *
   * Use to initialise per-conversation state that must be ready before the
   * first turn (e.g. a token-budget tracker so the state field is never
   * `undefined` in the initial UI snapshot).
   */
  onInitConversation?(ctx: ToolSetContext): void;
  /**
   * Called when a sub-agent conversation's history is cleared.
   * Use to reset per-conversation state (e.g. token counters).
   */
  onResetConversation?(ctx: ToolSetContext): void;
  /**
   * Called when a sub-agent conversation is permanently removed.
   *
   * Use to release per-conversation state.
   * NOT called when the entire sub-agent is deleted — `onRemoveSession`
   * handles that case.
   */
  onRemoveConversation?(ctx: ToolSetContext): void;

  // ── Per-run hooks (fire once per sendMessage call) ─────────────────────────

  /**
   * Called before every `sendMessage` attempt — including both UI-originated
   * sends and programmatic sends from tools (e.g. `send_async_message`).
   *
   * Return `{ intercepted: true }` to claim the message: the send call stops
   * and the message is not delivered to the agent.  Only the **first** ToolSet
   * that returns `{ intercepted: true }` takes effect (registration order).
   *
   * `isLoading` indicates whether the agent is currently processing a previous
   * message.  ToolSets typically intercept only when `isLoading` is `true`,
   * queueing the message for the next available turn.
   *
   * Does NOT fire for edit operations (`editAndSendMessage`,
   * `editConversationMessage`) — edits are never intercepted.
   *
   * @param ctx       ToolSet context (session, agent, conversation ids).
   * @param message   The message being sent (`content` + optional `attachments`).
   * @param isLoading Whether the agent is currently processing a message.
   */
  onInterceptMessage?(
    ctx: ToolSetContext,
    message: { readonly content: string; readonly attachments?: readonly Attachment[] },
    isLoading: boolean,
  ): InterceptResult;

  /**
   * Called once per user message, immediately before the agent loop starts.
   *
   * Receives the full conversation history at that point (including the new
   * user message already appended).  Use for per-run bookkeeping that must
   * happen before any LLM turn — e.g. snapshotting history for graph
   * diffing, or auto-storing user attachments in the variable store.
   *
   * Note the asymmetry with `onAfterTurn`: this hook fires once per agent
   * run; `onAfterTurn` fires once per LLM turn within that run.
   */
  onBeforeRun?(ctx: ToolSetContext, history: readonly AgentMessage[]): void;
  /**
   * Called before each LLM invocation (every turn of the agent loop).
   *
   * Return messages to prepend to the conversation history immediately before
   * this turn's handler call.  Contributions from all ToolSets are concatenated
   * in registration order.
   *
   * Unlike `onBeforeRun` (once per user message), this fires once per LLM
   * turn — use it to inject queued user interjections, not for one-time setup.
   */
  onBeforeInvoke?(ctx: ToolSetContext): AgentMessage[];
  /**
   * Called once after the entire agent run finishes — regardless of how it
   * ended.  See `AgentRunOutcome` for the possible values.
   *
   * Use for post-run bookkeeping or to trigger a follow-up run (e.g. draining
   * queued user messages that arrived during the last turn and were not
   * captured by `onBeforeInvoke`).
   *
   * Implementations that call `sendMessage` should do so synchronously (no
   * `await` before the call) so that the new run starts after `isLoading` is
   * already `false`.
   */
  onAfterRun?(ctx: ToolSetContext, outcome: AgentRunOutcome): void;

  // ── Per-turn hooks (fire once per LLM invocation) ─────────────────────────

  /**
   * System-prompt injection hook called before each LLM invocation.
   *
   * The returned string (if any) is appended to the agent's base system prompt
   * for that turn.  Return `undefined` to inject nothing.
   *
   * `promptCtx` carries the user message, the agent's base system prompt, and
   * the accumulated system prompt from all ToolSets that ran before this one —
   * enabling conditional injection or cross-ToolSet awareness.
   */
  onGetSystemPrompt?(
    ctx: ToolSetContext,
    promptCtx: SystemPromptContext,
    /** All ToolSets currently registered on this agent, in registration order. */
    toolSets: readonly ToolSet[],
  ): string | undefined;
  /**
   * Tool-filtering hook called before each LLM invocation.
   *
   * Receives the full list of registered tools and returns the subset that
   * should be visible to the model for this turn.  Filters from multiple
   * ToolSets are applied in registration order — each receives the output of
   * the previous.  Return the input unchanged to apply no filtering.
   */
  onFilterTools?(ctx: ToolSetContext, tools: readonly Tool[]): readonly Tool[];
  /**
   * Called at the end of every LLM turn — after the assistant response is
   * produced and all tool results are appended to history.
   *
   * Use to record token usage and optionally compact the conversation history
   * (e.g. via summarisation).  Return a `CompactionResult` to replace the
   * history; return `void` / `undefined` to leave it unchanged.
   *
   * The `handler` argument is the raw `AgentHandler` driving the current
   * agent.  ToolSets that make meta-calls (summarisation, graph updates) are
   * responsible for constructing their own `HandlerContext` — set `tools: []`
   * and `toolChoice: 'none'` to prevent recursive tool use, and provide a
   * task-specific `systemPrompt` rather than leaking the agent's base prompt.
   */
  onAfterTurn?(
    ctx: ToolSetContext,
    history: AgentMessage[],
    usage: TokenUsage | undefined,
    signal: AbortSignal,
    handler: AgentHandler,
  ): Promise<CompactionResult | void>;

  // ── Per-tool-call hooks (fire once per tool execution) ────────────────────

  /**
   * Called at the start of the tool-call pipeline to transform arguments
   * before Zod validation and execution.
   *
   * Use to resolve symbolic handles or perform argument rewriting.  Return the
   * (possibly mutated) args; returning the input unchanged applies no change.
   */
  onResolveToolArgs?(
    ctx: ToolSetContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown>;
  /**
   * Called after `onResolveToolArgs` to build a partial `ToolExecutionContext`
   * patch for this tool call.
   *
   * Attach a `comment` string to the function to document what fields this
   * patch injects — `createDynamicToolset` reads those comments to inform the
   * AI about context available inside frontend tool implementations.
   *
   * Patches from all ToolSets are shallow-merged in registration order (later
   * wins on conflicts) and applied on top of the base context.  The most
   * common use-case is injecting `requestUserInput` so tools can surface
   * interactive prompts in the session UI.
   *
   * Return `undefined` to leave the context unchanged.
   */
  onPatchToolContext?: ToolContextPatch;

  /**
   * Called **before** every tool-execution, after `onPatchToolContext` and
   * after Zod validation of the tool arguments.
   *
   * Use for input validation, permission checking, rate limiting, audit
   * logging, or any other pre-execution interception.
   *
   * **Chaining**: multiple ToolSets' hooks run in registration order.  If
   * any hook returns `{ allow: false, result }`, the chain stops and that
   * result is returned to the caller — the tool is never executed.
   * Hooks that return `void` / `undefined` are treated as `{ allow: true }`.
   *
   * **Relation to `onResolveToolArgs`**: argument rewriting (handle resolution,
   * coercion) happens in `onResolveToolArgs`.  This hook runs after rewritten
   * args have been Zod-validated, so the `args` you receive are guaranteed to
   * pass the tool's schema.
   *
   * @param ctx      ToolSet context (session, agent, conversation ids).
   * @param toolName Name of the tool being called.
   * @param tool     The resolved Tool instance.
   * @param args     Zod-validated tool arguments (after resolve + validation).
   * @param execCtx  The full execution context for this call (includes signal,
   *                 requestUserInput, and any patches from onPatchToolContext).
   */
  onBeforeToolExecute?(
    ctx: ToolSetContext,
    toolName: string,
    tool: Tool,
    args: Record<string, unknown>,
    execCtx: ToolExecutionContext,
  ): Promise<{ allow: true } | { allow: false; result: ToolResult } | void>;

  /**
   * Called after a tool finishes executing to intercept or transform its result.
   *
   * Use to post-process, filter, or replace tool output — e.g. automatically
   * storing large results in the variable store and replacing them with handles.
   * Return the (possibly replaced) result.
   */
  onToolResult?(ctx: ToolSetContext, toolName: string, result: ToolResult): ToolResult;

  // ── State & persistence ────────────────────────────────────────────────────

  /**
   * Returns this ToolSet's current state contribution for a session.
   *
   * The returned fields are merged into `AgentSessionState` so UI components
   * can read them without knowing which ToolSet produced them.
   * `stateCtx.tools` contains all tools registered for the session at call time.
   */
  onGetState?(ctx: ToolSetContext, stateCtx?: ToolSetStateContext): ToolSetState;
  onGetSymbolState?(ctx: ToolSetContext, stateCtx?: ToolSetStateContext): PluginStateExtension & PluginUiAdapter;
  /**
   * Subscribe to this ToolSet's state changes for a session.
   *
   * The SDK calls this when wiring per-session UI subscriptions.  When the
   * ToolSet's internal state changes, call `fn` to trigger a re-render.
   * Must return an unsubscribe function.
   */
  onSubscribe?(ctx: ToolSetContext, fn: () => void): () => void;
  /**
   * Serialise this ToolSet's per-session state for persistence.
   *
   * Called by `buildSnapshot` whenever a session snapshot is taken.  The
   * returned object is spread into `SessionEntryData` and passed back to
   * `onInitSession` on the next page load.
   */
  onBuildSnapshot?(ctx: ToolSetContext): Partial<SessionEntryExtension>;
};
