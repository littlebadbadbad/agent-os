/**
 * internal-plugins/token-budget/agent/activate.ts — Token Budget plugin activation entry
 *
 * This is the plugin's agent-side entry point, loaded by the plugin runtime
 * when the token-budget extension is activated.
 *
 * The plugin receives an AgentPluginHost and registers its ToolSet.
 * The ToolSet's `getConfig` factory reads the current model's context window
 * from `host.getSelectedModel()` — no dependency on the UI layer's provider store.
 */

import type { AgentPluginHost } from '@agent-type';
import { createTokenBudgetToolSet } from './tokenBudgetToolSet';

/**
 * Activate the token-budget plugin.
 *
 * Builds the token-budget ToolSet with a config factory that derives
 * `maxTokens` from the currently selected model's context window.
 *
 * @param host  The AgentPluginHost for this plugin.
 */
export function activate(host: AgentPluginHost): void {
  const toolSet = createTokenBudgetToolSet(() => {
    const { contextWindow } = host.getSelectedModel();
    return contextWindow
      ? { maxTokens: contextWindow, warningThreshold: 0.7, summarizationThreshold: 0.85 }
      : undefined;
  });
  host.registerToolSet(toolSet);
}
