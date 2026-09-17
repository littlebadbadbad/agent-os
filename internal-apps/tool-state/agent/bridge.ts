/**
 * Tool State bridge — the `toolButton` (global) control surface.
 *
 * The toolButton slot is session-independent: it may be rendered with no
 * active session, in which case `host.getAppState()` returns `undefined` and
 * the panel-refresh push chain never fires. Like the MCP app, the global
 * panel therefore drives everything through the shared bridge object (same
 * reference on both the agent and UI sides) rather than app state.
 *
 * The bridge exposes a *pull + subscribe* API over the
 * {@link GlobalToolStore}: the UI reads the current tool list, toggles
 * global state, and re-renders on `subscribe` callbacks.
 */

import type { Tool } from '@agent-type';
import type { GlobalToolStore } from './globalStore';
import type { ToolStateEntry } from './types';
import { resolveDescription, isResident } from './toolMeta';

/**
 * Bridge methods installed onto `host.bridge` during activation.
 * Consumed by the toolButton dropdown UI.
 */
export interface ToolStateBridge {
  /** Every tool known to the runtime, with its global enabled/disabled flag. */
  getGlobalToolStates(): ToolStateEntry[];
  /** Snapshot of globally-disabled tool names. */
  getGlobalDisabled(): readonly string[];
  /** Number of globally-disabled tools (drives the toolButton badge). */
  getGlobalDisabledCount(): number;
  /** Whether a specific tool is globally disabled. */
  isGloballyDisabled(name: string): boolean;
  /** Flip a tool's global state; returns the new disabled flag. */
  toggleGlobal(name: string): boolean;
  /** Replace the whole globally-disabled set. */
  setGlobalDisabled(names: readonly string[]): void;
  /** Subscribe to global-store changes; returns an unsubscribe function. */
  subscribeGlobal(fn: () => void): () => void;
}

/**
 * Create the bridge implementation.
 *
 * @param store  The global (cross-session) disabled store.
 * @param getToolPool  Returns the full registered tool pool — supplied by the
 *   ToolSet so the global panel can list every tool, not just those visible
 *   to a particular session.
 */
export function createToolStateBridge(
  store: GlobalToolStore,
  getToolPool: () => readonly Tool[],
): ToolStateBridge {
  return {
    getGlobalToolStates() {
      // Resident tools are not user-manageable globally — hide them from the
      // toolButton panel (they are always enabled everywhere).
      return getToolPool()
        .filter((t) => !isResident(t.name))
        .map((t) => ({
          name: t.name,
          description: resolveDescription(t),
          enabled: !store.isDisabled(t.name),
          group: t.group,
        }));
    },
    getGlobalDisabled: () => store.getDisabled(),
    getGlobalDisabledCount: () => store.size(),
    isGloballyDisabled: (name) => store.isDisabled(name),
    toggleGlobal: (name) => store.toggle(name),
    setGlobalDisabled: (names) => store.setDisabled(names),
    subscribeGlobal: (fn) => store.subscribe(fn),
  };
}
