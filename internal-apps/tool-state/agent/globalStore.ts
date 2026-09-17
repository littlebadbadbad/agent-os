/**
 * Global (cross-session) tool disabled set — the single source of truth
 * behind the `toolButton` control.
 *
 * One ToolSet instance is shared by the (single) agent runtime, so a
 * module-level store here is effectively global across every session.
 * A tool present in this set is force-disabled in ALL sessions:
 *   - filtered out of the visible tool pool (onFilterTools),
 *   - blocked at execution time (onBeforeToolExecute),
 *   - unenable-able from per-session panels or `manage_tools`,
 *   - rendered as a locked (greyed-out, non-togglable) row in the
 *     per-session Tools panel.
 *
 * Resident tools (e.g. `manage_tools`) can never enter this set — the
 * store refuses them in every mutator.
 *
 * Subscribers are notified on every mutation so the toolButton badge,
 * the dropdown UI, and every mounted session panel can refresh.
 */

import { isResident } from './toolMeta';

export interface GlobalToolStore {
  /** Whether the tool is globally disabled (force-off in every session). */
  isDisabled(name: string): boolean;
  /** Immutable snapshot of all globally disabled tool names. */
  getDisabled(): readonly string[];
  /** Number of globally disabled tools. */
  size(): number;
  /** Disable a tool globally (idempotent; notifies on change). */
  disable(name: string): void;
  /** Re-enable a tool globally (idempotent; notifies on change). */
  enable(name: string): void;
  /** Flip global state; returns the new disabled flag. */
  toggle(name: string): boolean;
  /** Replace the whole disabled set (notifies on change). */
  setDisabled(names: readonly string[]): void;
  /** Subscribe to any change; returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

export function createGlobalToolStore(): GlobalToolStore {
  const disabled = new Set<string>();
  const subscribers = new Set<() => void>();

  const notify = (): void => {
    subscribers.forEach((fn) => fn());
  };

  return {
    isDisabled: (name) => disabled.has(name),
    getDisabled: () => [...disabled],
    size: () => disabled.size,
    disable(name) {
      if (isResident(name)) return;
      if (!disabled.has(name)) {
        disabled.add(name);
        notify();
      }
    },
    enable(name) {
      if (disabled.delete(name)) notify();
    },
    toggle(name) {
      if (isResident(name)) return disabled.has(name);
      if (disabled.delete(name)) {
        notify();
        return false;
      }
      disabled.add(name);
      notify();
      return true;
    },
    setDisabled(names) {
      const next = new Set(names.filter((n) => !isResident(n)));
      const changed =
        next.size !== disabled.size || [...next].some((n) => !disabled.has(n));
      if (!changed) return;
      disabled.clear();
      for (const n of next) disabled.add(n);
      notify();
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}

/**
 * Process-wide singleton — one store per agent runtime (same lifetime and
 * sharing model as the ToolSet instance it backs). Exposed to the UI via
 * the app bridge and consumed by the ToolSet hooks and slot declarations.
 */
export const globalToolStore: GlobalToolStore = createGlobalToolStore();
