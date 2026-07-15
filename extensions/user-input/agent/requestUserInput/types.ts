/**
 * extensions/user-input/agent/requestUserInput/types.ts — User Input type definitions
 *
 * Types shared between the store and toolSet modules.
 *
 * NOTE: `UserInputRequest` is imported from `@agent-type` — the canonical
 * discriminated union defined in `agent-type/core.ts`. Do NOT redefine it here.
 */

import type { UserInputRequest } from "@agent-type";

// ── InlinePromptEntry (UI-facing prompt snapshot) ──────────────────────────────

/** Discriminant for the UI to decide which widget to render. */
export type InlinePromptKind =
  | "text"
  | "confirm"
  | "select"
  | "multiSelect"
  | "number";

/** A prompt entry exposed to the UI (minus the internal `resolve` callback). */
export interface InlinePromptEntry {
  readonly id: string;
  readonly kind: InlinePromptKind;
  readonly message: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly options?: readonly string[];
  readonly minSelect?: number;
  readonly maxSelect?: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly conversationId: string;
  readonly agentName: string;
  /** Ephemeral prompts are not persisted across page reloads. */
  readonly ephemeral?: boolean;
  /**
   * Whether this prompt's answer should produce a `role: 'tool'` message
   * (`true`) or a new user message (`false`).
   * Persisted in session snapshots and restored on reload.
   */
  readonly boundToTool: boolean;
  /**
   * The original tool-call ID for bound prompts.
   * Used after restore to synthesise a tool-call + tool-result pair.
   */
  readonly toolCallId?: string;
  /**
   * The original tool name (e.g. `'ask_user'`) for bound prompts.
   * Used after restore to synthesise the tool-call + tool-result pair.
   */
  readonly toolName?: string;
}


// ── UserInputStore (internal) ─────────────────────────────────────────────────

/** Internal bucket per session. */
export interface UserInputBucket {
  entries: Map<string, InlinePromptEntryInternal>;
  subs: Set<() => void>;
  responder: ((id: string, value: string | null) => void) | undefined;
}

/** Internal entry that includes the Promise `resolve` callback. */
export interface InlinePromptEntryInternal extends InlinePromptEntry {
  resolve: (value: string | null) => void;
}

/** The store API returned by `createUserInputStore`. */
export interface UserInputStore {
  add(sessionId: string, entry: InlinePromptEntryInternal): void;
  remove(sessionId: string, id: string, value: string | null): void;
  getAll(sessionId: string): readonly InlinePromptEntry[];
  getResponder(sessionId: string): (id: string, value: string | null) => void;
  subscribe(sessionId: string, fn: () => void): () => void;
  removeSession(sessionId: string): void;
  resetSession(sessionId: string): void;
  serialize(sessionId: string): readonly InlinePromptEntry[];
  addGhost(
    sessionId: string,
    prompt: InlinePromptEntry,
    onResolve: (value: string | null) => void,
  ): void;
  /**
   * Replace the resolve callback for an existing entry.
   * Used by `onSessionReady` to wire ghost-restored prompts to the correct
   * handler (`sendMessage` for unbound, `injectToolResult` for bound).
   */
  replaceResolve(sessionId: string, id: string, resolve: (value: string | null) => void): void;
  /**
   * Cancel all pending prompts for a session.
   * Each entry's resolve is called with `null` and the store is cleared.
   */
  cancelAll(sessionId: string): void;
}

// ── UserInputAdapter (external prompt handling) ───────────────────────────────

/** Optional adapter for handling prompts outside the chat UI. */
export interface UserInputAdapter {
  /**
   * Called when `requestUserInput()` is invoked.
   * When an adapter is present, the prompt is forwarded here instead of
   * showing in the chat UI.  Returns the user's response.
   */
  prompt(request: UserInputRequest): Promise<string | null>;
}

// ── Module augmentation ───────────────────────────────────────────────────────

declare module "@agent-type" {
  interface SessionEntryExtension {
    /** Persisted pending user-input prompts (non-ephemeral). */
    pendingUserInputs?: readonly InlinePromptEntry[];
  }
}
