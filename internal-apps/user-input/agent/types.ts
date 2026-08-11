/**
 * internal-apps/user-input/agent/types.ts — User-Input app discriminated union
 *
 * Defines the union type for this app's ToolSet state slices.
 * Each ToolSet contributes one variant distinguished by `type`.
 *
 * Usage in the UI layer:
 *   const state = host.getAppState()?.[1]; // 2-tuple: [base, toolSetState]
 *   if (state.type === "requestUserInput") { ... }
 *   if (state.type === "pendingInput") { ... }
 */

import type { InlinePromptEntry } from "./requestUserInput/types";

/** ToolSet state for requestUserInput (ask_user tool). */
export interface UserInputPromptState {
  readonly type: "requestUserInput";
  readonly pendingUserInputs: ReadonlyArray<InlinePromptEntry>;
  readonly respondUserInput: (id: string, value: string | null) => void;
}

/** ToolSet state for pendingInput (message queuing). */
export interface PendingInputStripState {
  readonly type: "pendingInput";
  readonly queueUserInput: (text: string) => void;
  readonly pendingInputCount: number;
  readonly pendingInputMessages: ReadonlyArray<{ id: string; text: string }>;
  readonly cancelQueuedInput: (id: string) => void;
  readonly resumeQueuedInputs: () => void;
}

/** App-level discriminated union for all ToolSet state slices. */
export type UserInputAppState =
  | UserInputPromptState
  | PendingInputStripState;

