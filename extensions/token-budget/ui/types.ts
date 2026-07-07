/**
 * extensions/token-budget/ui/types.ts — Type guards for plugin state indices
 *
 * The host's `getPluginState()` returns a tuple:
 *   [0] = AgentSessionState (base)
 *   [1..N] = PluginStateExtension & PluginUiAdapter (symbol states)
 *
 * The token-budget extension's symbol state is at a dynamic index. We use a
 * type guard to safely extract it.
 */

import type { AgentSessionState, PluginStateExtension, PluginUiAdapter } from '@agent-type';
import type { TokenBudgetSymbolState } from '../agent/types';

/**
 * Extract the TokenBudgetSymbolState from the plugin state tuple.
 *
 * Iterates symbol states (index 1..N) and returns the first one
 * with `type === 'tokenBudget'`.
 *
 * @returns The TokenBudgetSymbolState, or `undefined` if not found.
 */
export function getTokenBudgetSymbolState(
  pluginState: [AgentSessionState, ...(PluginStateExtension & PluginUiAdapter)[]] | undefined,
): TokenBudgetSymbolState | undefined {
  if (!pluginState) return undefined;
  for (let i = 1; i < pluginState.length; i++) {
    const entry = pluginState[i] as Partial<TokenBudgetSymbolState>;
    if (entry && entry.type === 'tokenBudget') {
      return entry as TokenBudgetSymbolState;
    }
  }
  return undefined;
}
