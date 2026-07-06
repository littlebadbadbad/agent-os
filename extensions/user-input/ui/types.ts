/**
 * extensions/user-input/ui/types.ts — Unified UI type entry point
 *
 * Re-exports canonical types from the agent layer so every UI component
 * imports from a single source.  Type guards narrow `getPluginState()` results.
 *
 * Index convention (matches activate.ts registration order):
 *   getPluginState()[0] → AgentSessionState (base, always first)
 *   getPluginState()[1] → UserInputSymbolState (first registered toolset)
 *   getPluginState()[2] → PendingInputSymbolState (second registered toolset)
 *
 * Each toolset injects a static `type` discriminant (e.g. `"requestUserInput"`)
 * into its onGetSymbolState return. Type guards use this for precise narrowing.
 */

import type { AgentSessionState } from "@agent-type";
import type { UserInputPromptState } from "../agent/requestUserInput/types";

// ── Re-exports (canonical types from agent layer) ────────────────────────────

export type { InlinePromptEntry } from "../agent/requestUserInput/types";
export type { UserInputPromptState } from "../agent/requestUserInput/types";
export type { PendingInputSymbolState } from "../agent/pendingInput";

// ── UI component state types ──────────────────────────────────────────────────

/** PendingInputStrip component state — subset of PendingInputSymbolState. */
export interface PendingInputStripState {
  readonly type: "pendingInput";
  readonly pendingInputMessages: ReadonlyArray<{ id: string; text: string }>;
  readonly cancelQueuedInput?: (id: string) => void;
  readonly resumeQueuedInputs?: () => void;
  readonly pendingInputCount: number;
}

/** Input state persisted per prompt across navigation. */
export interface PromptInputState {
  textValue: string;
  selectedOptions: ReadonlySet<string>;
}

// ── Type guards (narrow getPluginState() index results via `type` discriminant)

/** Type guard: `AgentSessionState` (state[0] — always first). */
export function isAgentSessionState(v: unknown): v is AgentSessionState {
  return (
    typeof v === "object" &&
    v !== null &&
    "messages" in v &&
    "isLoading" in v &&
    "id" in v
  );
}

/**
 * Type guard: `UserInputPromptState` (state[1] by convention).
 * Uses the `type` discriminant injected by UserInputToolSet.onGetSymbolState.
 */
export function isUserInputPromptState(v: unknown): v is UserInputPromptState {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.type === "requestUserInput" &&
    Array.isArray(r.pendingUserInputs) &&
    typeof r.respondUserInput === "function"
  );
}

/**
 * Type guard: `PendingInputStripState` (state[2] by convention).
 * Uses the `type` discriminant injected by PendingInputToolSet.onGetSymbolState.
 */
export function isPendingInputStripState(
  v: unknown,
): v is PendingInputStripState {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.type === "pendingInput" &&
    Array.isArray(r.pendingInputMessages) &&
    typeof r.pendingInputCount === "number"
  );
}
