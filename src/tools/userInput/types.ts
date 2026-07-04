// ── UserInput types ───────────────────────────────────────────────────────────
// These types live here (inside the userInput ToolSet) rather than in
// tools/types/core.ts.  ToolExecutionContext is extended below via module
// augmentation, exactly the same pattern as SessionEntryExtension.

/**
 * Describes a user-input request that a tool can issue at runtime.
 *
 * The discriminated union lets the UI render the appropriate widget:
 * - `'confirm'` → yes/no dialog
 * - `'text'`    → free-form text input
 * - `'select'`  → single-choice from a fixed list
 *
 * The optional `ephemeral` flag marks a request as transient: it will not be
 * persisted in session snapshots and will not be replayed on page reload.
 * Use this for tool-internal prompts (e.g. a "cancel waiting" button) that
 * only make sense while the tool is actively running.
 */
export type UserInputRequest = {
  /**
   * When `true` the request is not included in session snapshots and will not
   * be replayed on page reload.  Set this for tool-internal cancel/interrupt
   * prompts that only make sense while the originating tool is running.
   */
  readonly ephemeral?: true;
} & (
  | { readonly type: 'confirm'; readonly message: string }
  | { readonly type: 'text'; readonly message: string; readonly placeholder?: string; readonly defaultValue?: string }
  | { readonly type: 'select'; readonly message: string; readonly options: readonly string[] }
  | { readonly type: 'multiSelect'; readonly message: string; readonly options: readonly string[]; readonly minSelect?: number; readonly maxSelect?: number }
  | { readonly type: 'number'; readonly message: string; readonly placeholder?: string; readonly defaultValue?: number; readonly min?: number; readonly max?: number; readonly step?: number }
);

/**
 * Adapter that handles user-input requests outside the default React UI.
 *
 * Supply this when running in a headless, terminal, or custom-UI environment.
 * Return `null` to signal that the user cancelled / dismissed the prompt.
 *
 * @example
 * ```ts
 * // Minimal browser wrapper
 * const userInputAdapter: UserInputAdapter = {
 *   prompt: ({ type, message }) =>
 *     Promise.resolve(
 *       type === 'confirm'
 *         ? window.confirm(message) ? 'yes' : null
 *         : window.prompt(message),
 *     ),
 * };
 * ```
 */
export type UserInputAdapter = {
  prompt(request: UserInputRequest): Promise<string | null>;
};

// ── ToolExecutionContext augmentation ─────────────────────────────────────────
// Contributes `requestUserInput` and `cancelUserInput` to ToolExecutionContext,
// exactly the same pattern as SessionEntryExtension — kept in this ToolSet so
// core.ts does not depend on userInput-specific types.

declare module '@agent-type' {
  interface ToolExecutionContextExtension {
    /**
     * Request a value from the user, suspending tool execution until a response arrives.
     *
     * How resolution works depends on the environment:
     * - **Default UI**: surfaces an inline prompt card in the chat; tool execution
     *   suspends until the user submits a value via `session.respondUserInput()`.
     * - **Custom adapter** (`userInputAdapter` in config): delegates to the adapter's
     *   `prompt()` immediately — suitable for terminal readline, custom modals, tests, etc.
     * - **Absent** (headless, no adapter): resolves immediately with `null`.
     *
     * Returns `null` when the user cancels or the `AbortSignal` fires.
     *
     * @param id  Optional stable identifier for this request.  Supply a pre-generated
     *            `crypto.randomUUID()` when you also need to cancel the prompt
     *            programmatically via `cancelUserInput`.
     */
    readonly requestUserInput: (request: UserInputRequest, id?: string) => Promise<string | null>;
    /**
     * Programmatically withdraw a pending user-input request before the user
     * responds.  The waiting `requestUserInput` call resolves with `null` and the
     * UI card is removed immediately.
     *
     * Pass the same `id` that was supplied to `requestUserInput`.
     * No-op when the entry has already been resolved or does not exist.
     *
     * Only available when `createUserInputToolSet` is registered.
     */
    readonly cancelUserInput?: (id: string) => void;
  }
}

// ── Module augmentation ───────────────────────────────────────────────────────
// Injects user-input state into AgentSessionState without touching SDK core.

declare module '@agent-type' {
  interface AgentSessionExtension {
    /**
     * All in-flight user-input requests from the main agent and every
     * sub-agent conversation, in insertion order.
     *
     * Each entry carries `conversationId` and `agentName` so the UI can
     * display the origin context alongside the prompt.
     *
     * Populated only when `createUserInputToolSet` is registered.
     */
    pendingUserInputs?: readonly PendingUserInput[];
    /**
     * Stable function reference — call with the request `id` to unblock
     * the tool that issued the request.
     *
     * Populated only when `createUserInputToolSet` is registered.
     */
    respondUserInput?: (id: string, value: string | null) => void;
  }
}

declare module '@agent-type' {
  interface SessionEntryExtension {
    /** Non-ephemeral pending user-input requests to restore as ghost entries. */
    pendingUserInputs?: readonly PendingUserInput[];
  }
}

/**
 * A pending user-input request from any agent in the session (main agent or
 * sub-agent), surfaced in `AgentSessionState.pendingUserInputs`.
 *
 * Call `state.respondUserInput(id, value)` to unblock the waiting tool.
 */
export type PendingUserInput = {
  /** Unique ID — must be echoed back to `respondUserInput`. */
  readonly id: string;
  /** The input request the tool issued. */
  readonly request: UserInputRequest;
  /**
   * Conversation in which this request originated.
   * `'main'` for the root agent; the per-conversation ID for sub-agents.
   */
  readonly conversationId: string;
  /** Name of the agent that issued the request. */
  readonly agentName: string;
};

/** Internal entry — extends PendingUserInput with the resolve function. */
export type PendingEntry = PendingUserInput & {
  readonly resolve: (v: string | null) => void;
};

export type UserInputToolSetOptions = {
  /**
   * Adapter for headless / custom-UI environments.
   *
   * When provided, all `requestUserInput` calls are forwarded directly to
   * `adapter.prompt()` and bypass the session state queue entirely — no
   * `pendingUserInputs` entries are created.
   */
  adapter?: UserInputAdapter;
};
