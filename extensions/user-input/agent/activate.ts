/**
 * extensions/user-input/agent/activate.ts — User Input plugin activation entry
 *
 * This is the plugin's agent-side entry point, loaded by the plugin runtime
 * when the user-input extension is activated.
 *
 * Registers TWO toolsets:
 *   1. UserInputToolSet (ask_user tool + requestUserInput injection)
 *   2. PendingInputToolSet (message queuing during agent loop)
 *
 * Registration order determines getPluginState() indices:
 *   [0] = AgentSessionState (base, always first — provided by host)
 *   [1] = UserInputSymbolState  (first registered toolset)
 *   [2] = PendingInputSymbolState (second registered toolset)
 *
 * Both stores are created externally so the composite shouldRender condition
 * can check both toolset states before the inline iframe mounts.
 */

import type { AgentPluginHost } from "@agent-type";
import { createUserInputToolSet } from "./requestUserInput";
import { createPendingInputToolSet } from "./pendingInput";
import { createUserInputStore } from "./requestUserInput/store";
import { createPendingInputStore } from "./pendingInput/store";

export function activate(host: AgentPluginHost): void {
  // ── Create stores externally so composite shouldRender can read both ────────
  const userInputStore = createUserInputStore();
  const pendingStore = createPendingInputStore();

  // ── Composite shouldRender: show inline iframe if EITHER toolset has content ─
  // Called per-session by onGetSymbolState → creates a stable closure per sessionId.
  const shouldRenderInlinePrompt = (sessionId: string) => (): boolean =>
    userInputStore.getAll(sessionId).length > 0 ||
    pendingStore.getQueue(sessionId).length > 0;

  // ── Register userInput FIRST → plugin.symbols[0] → getPluginState()[1] ──────
  const userInputToolSet = createUserInputToolSet({
    store: userInputStore,
    shouldRenderInlinePrompt,
  });
  host.registerToolSet(userInputToolSet);

  // ── Register pendingInput SECOND → plugin.symbols[1] → getPluginState()[2] ──
  const pendingInputToolSet = createPendingInputToolSet({
    store: pendingStore,
  });
  host.registerToolSet(pendingInputToolSet);
}
