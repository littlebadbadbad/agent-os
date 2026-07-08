/**
 * agent-UI/plugin/discoverSlots.ts — Shared slot discovery
 *
 * Iterates active plugins' symbol-keyed state slices and collects all
 * {@link PluginSlotDeclaration}s registered via {@link PluginUiAdapter.slots}.
 *
 * Used by both the main-agent slot registry and sub-agent conversation panes.
 * The only difference between the two callers is the output target:
 *   - `pluginSystem.refreshSlots()` → calls `slotRegistry.register()` per entry
 *   - `discoverSubAgentSlots()` → returns entries as a flat array for inline rendering
 *
 * This function lives here so both callers delegate to a single implementation.
 *
 * ## Why `state` is typed as `unknown`
 *
 * `AgentSessionState` (main agent) provides symbol-keyed access via
 * `AgentSessionExtension extends Record<string, unknown>` while
 * `SubAgentConversationState` (sub-agent) has `readonly [key: symbol]:
 * PluginStateExtension & PluginUiAdapter`.  These two index-signature
 * shapes are not statically compatible, so this function accepts `unknown`
 * and validates at runtime — no type assertions required at call sites.
 */

import type { PluginSlotDeclaration } from '@agent-type';
import type { SlotEntry } from '../slots/registry';
import type { ActivatedPluginInfo } from './pluginSystem';

/**
 * Runtime check: does the value look like it has a `slots` array?
 * @returns The `slots` array, or `undefined`.
 */
function tryGetSlots(value: unknown): readonly PluginSlotDeclaration[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('slots' in value)) return undefined;
  const obj = value as { readonly slots: unknown };
  if (!Array.isArray(obj.slots)) return undefined;
  return obj.slots as readonly PluginSlotDeclaration[];
}

/**
 * Discover all plugin slot declarations from a session/conversation state.
 *
 * @param state   Session or conversation state snapshot.  Typed as
 *                `unknown` because the main-agent and sub-agent state
 *                types use incompatible index signatures; runtime guards
 *                handle both uniformly.
 * @param plugins Active plugins whose symbol-keyed state to inspect.
 * @returns Flat list of `{ pluginId, declaration }` entries.
 */
export function discoverSlots(
  state: unknown,
  plugins: readonly ActivatedPluginInfo[],
): readonly SlotEntry[] {
  // Guard: must be a non-null object for Reflect.get to work safely.
  if (typeof state !== 'object' || state === null) {
    return [];
  }

  const entries: SlotEntry[] = [];
  for (const plugin of plugins) {
    for (const sym of plugin.symbols) {
      const slots = tryGetSlots(Reflect.get(state, sym));
      if (slots) {
        for (const slot of slots) {
          entries.push({ pluginId: plugin.id, declaration: slot });
        }
      }
    }
  }
  return entries;
}
