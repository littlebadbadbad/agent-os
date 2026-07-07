/**
 * extensions/todo/ui/types.ts — Type guards for plugin state indices
 *
 * The host's `getPluginState()` returns a tuple:
 *   [0] = AgentSessionState (base)
 *   [1..N] = PluginStateExtension & PluginUiAdapter (symbol states)
 *
 * The todo extension's symbol state is at a dynamic index. We use a
 * type guard to safely extract it.
 */

import type { AgentSessionState, PluginStateExtension, PluginUiAdapter } from '@agent-type';
import type { TodoSymbolState } from '../agent/types';

/**
 * Extract the TodoSymbolState from the plugin state tuple.
 *
 * Iterates symbol states (index 1..N) and returns the first one
 * with `type === 'todo'`.
 *
 * @returns The TodoSymbolState, or `undefined` if not found.
 */
export function getTodoSymbolState(
  pluginState: [AgentSessionState, ...(PluginStateExtension & PluginUiAdapter)[]] | undefined,
): TodoSymbolState | undefined {
  if (!pluginState) return undefined;
  for (let i = 1; i < pluginState.length; i++) {
    const entry = pluginState[i] as Partial<TodoSymbolState>;
    if (entry && entry.type === 'todo') {
      return entry as TodoSymbolState;
    }
  }
  return undefined;
}
