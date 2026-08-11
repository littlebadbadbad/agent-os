/**
 * internal-apps/user-input/agent/activate.ts — User Input app activation entry
 *
 * This is the app's agent-side entry point, loaded by the app runtime
 * when the user-input extension is activated.
 *
 * Registers TWO independent toolsets, each with its own slot:
 *   1. UserInputToolSet (ask_user tool) — inlinePrompt for user prompts
 *   2. PendingInputToolSet (message queuing) — inlinePrompt for queued messages
 *
 * Each toolset owns its store internally. Each slot receives only its
 * ToolSet's state via `getAppState()` returning `[base, toolSetState]`.
 */

import type { AgentAppHost } from "@agent-type";
import { createUserInputToolSet } from "./requestUserInput";
import { createPendingInputToolSet } from "./pendingInput";

export function activate(host: AgentAppHost): void {
  const userInputBundle = createUserInputToolSet();
  host.registerToolSet(userInputBundle.toolSet, userInputBundle.slotDeclarations);

  const pendingInputBundle = createPendingInputToolSet();
  host.registerToolSet(pendingInputBundle.toolSet, pendingInputBundle.slotDeclarations);
}
