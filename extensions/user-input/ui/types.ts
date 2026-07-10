/**
 * extensions/user-input/ui/types.ts — Unified UI type entry point
 *
 * Re-exports canonical types from the agent layer so every UI component
 * imports from a single source.  Type guards narrow `getPluginState()` results.
 *
 * With per-toolset slot isolation, each iframe receives a 2-tuple:
 *   getPluginState()[0] → SessionStateLike (base)
 *   getPluginState()[1] → UserInputPluginState & PluginUiAdapter (single toolset)
 *
 * The `type` discriminant determines which component to render.
 */

import type { PluginStateExtension, PluginUiAdapter } from "@agent-type";
import type {
  UserInputPromptState,
  PendingInputStripState,
  UserInputPluginState,
} from "../agent/types";

// ── Re-exports ────────────────────────────────────────────────────────────────

export type { InlinePromptEntry } from "../agent/requestUserInput/types";
export type {
  UserInputPromptState,
  PendingInputStripState,
  UserInputPluginState,
};

// ── UI component state types ──────────────────────────────────────────────────

/** Input state persisted per prompt across navigation. */
export interface PromptInputState {
  textValue: string;
  selectedOptions: ReadonlySet<string>;
}


/** Type guard: `UserInputPromptState` — has pending prompts. */
export function isUserInputPromptState(v: UserInputPluginState | undefined): v is UserInputPromptState & PluginUiAdapter {
  return v !== undefined && v.type === "requestUserInput";
}

/** Type guard: `PendingInputStripState` — has queued messages. */
export function isPendingInputStripState(v: UserInputPluginState | undefined): v is PendingInputStripState & PluginUiAdapter {
  return v !== undefined && v.type === "pendingInput";
}
