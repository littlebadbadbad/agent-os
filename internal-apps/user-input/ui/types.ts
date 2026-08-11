/**
 * internal-apps/user-input/ui/types.ts — Unified UI type entry point
 *
 * Re-exports canonical types from the agent layer so every UI component
 * imports from a single source.  Type guards narrow `getAppState()` results.
 *
 * With per-toolset slot isolation, each iframe receives a 2-tuple:
 *   getAppState()[0] → SessionStateLike (base)
 *   getAppState()[1] → UserInputAppState (single toolset)
 *
 * The `type` discriminant determines which component to render.
 */

import type { AppStateExtension } from "@agent-type";
import type {
  UserInputPromptState,
  PendingInputStripState,
  UserInputAppState,
} from "../agent/types";

// ── Re-exports ────────────────────────────────────────────────────────────────

export type { InlinePromptEntry } from "../agent/requestUserInput/types";
export type {
  UserInputPromptState,
  PendingInputStripState,
  UserInputAppState,
};

// ── UI component state types ──────────────────────────────────────────────────

/** Input state persisted per prompt across navigation. */
export interface PromptInputState {
  textValue: string;
  selectedOptions: ReadonlySet<string>;
}


/** Type guard: `UserInputPromptState` — has pending prompts. */
export function isUserInputPromptState(v: UserInputAppState | undefined): v is UserInputPromptState {
  return v !== undefined && v.type === "requestUserInput";
}

/** Type guard: `PendingInputStripState` — has queued messages. */
export function isPendingInputStripState(v: UserInputAppState | undefined): v is PendingInputStripState {
  return v !== undefined && v.type === "pendingInput";
}
