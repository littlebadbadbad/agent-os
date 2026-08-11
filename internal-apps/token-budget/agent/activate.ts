/**
 * internal-apps/token-budget/agent/activate.ts — Token Budget app activation entry
 *
 * This is the app's agent-side entry point, loaded by the app runtime
 * when the token-budget extension is activated.
 *
 * The app receives an AgentAppHost and registers its ToolSet.
 * The ToolSet's `getConfig` factory reads the current model's context window
 * from `host.getSelectedModel()` — no dependency on the UI layer's provider store.
 */

import type { AgentAppHost } from '@agent-type';
import { createTokenBudgetToolSet, getTokenBudgetSlotDeclarations } from './tokenBudgetToolSet';

/**
 * Activate the token-budget app.
 *
 * Builds the token-budget ToolSet with a config factory that derives
 * `maxTokens` from the currently selected model's context window, and
 * registers its `headerBar` UI slot.
 *
 * @param host  The AgentAppHost for this app.
 */
export function activate(host: AgentAppHost): void {
  const toolSet = createTokenBudgetToolSet(() => {
    const { contextWindow } = host.getSelectedModel();
    return contextWindow
      ? { maxTokens: contextWindow, warningThreshold: 0.7, summarizationThreshold: 0.85 }
      : undefined;
  });
  host.registerToolSet(toolSet, getTokenBudgetSlotDeclarations());
}
