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
}

// ── UI-facing view types (derived from symbol-state) ─────────────────────────

/** UserInputPrompt component state — a subset view of {@link UserInputSymbolState}. */
export interface UserInputPromptState {
  readonly type: "requestUserInput";
  readonly pendingUserInputs: ReadonlyArray<InlinePromptEntry>;
  readonly respondUserInput: (id: string, value: string | null) => void;
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
  interface PluginStateExtension {
    /** Discriminant — union of all toolset types in this plugin. */
    readonly type: "requestUserInput" | "pendingInput";
    readonly pendingUserInputs: ReadonlyArray<InlinePromptEntry>;
    readonly respondUserInput: (id: string, value: string | null) => void;
  }
}
