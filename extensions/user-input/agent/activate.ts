/**
 * extensions/user-input/agent/activate.ts — User Input plugin activation entry
 *
 * This is the plugin's agent-side entry point, loaded by the plugin runtime
 * when the user-input extension is activated.
 *
 * Registers TWO independent toolsets, each with its own slot:
 *   1. UserInputToolSet (ask_user tool) — inlinePrompt for user prompts
 *   2. PendingInputToolSet (message queuing) — inlinePrompt for queued messages
 *
 * Each toolset owns its store internally. Each slot receives only its
 * ToolSet's state via `getPluginState()` returning `[base, toolSetState]`.
 */

import type { AgentPluginHost } from "@agent-type";
import { createUserInputToolSet } from "./requestUserInput";
import { createPendingInputToolSet } from "./pendingInput";

export function activate(host: AgentPluginHost): void {
  host.registerToolSet(createUserInputToolSet());
  host.registerToolSet(createPendingInputToolSet());
}
