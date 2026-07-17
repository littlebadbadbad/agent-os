/**
 * agent-UI/plugin/PluginContext.tsx — React Provider + hooks for plugin system
 *
 * Replaces the old global-singleton + imperative refreshSlots() pattern with
 * a reactive React Context approach:
 *
 *   - {@link PluginProvider} wraps the widget content, subscribes to session
 *     state via `useSyncExternalStore`, and reactively builds a read-only
 *     {@link SlotRegistry} from the current session state's plugin slots.
 *   - {@link usePluginSystem} returns the global {@link PluginSystem} singleton.
 *   - {@link useSlotRegistry} returns the session-scoped {@link SlotRegistry}.
 *
 * No more `pluginSystem.refreshSlots(activeSession)` called on every render.
 * No more global `slotRegistry` singleton.  All components consume via hooks.
 *
 * Usage:
 * ```tsx
 * <PluginProvider session={activeSession}>
 *   <AIControlBar />
 *   <SessionContent />
 * </PluginProvider>
 * ```
 *
 * Inside any descendant:
 * ```tsx
 * const { getByType } = useSlotRegistry();
 * const { getPlugin } = usePluginSystem();
 * ```
 */

import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { SlotSession } from "@agent-type";
import { createSlotRegistry, type SlotRegistry } from "../slots/registry";
import { discoverSlots, toSlotEntries } from "./discoverSlots";
import { pluginSystem } from "@agent-UI/agents";
import type { PluginSystem } from "./pluginSystem";

// ── Context value ─────────────────────────────────────────────────────────────

interface PluginContextValue {
  /** Global plugin system singleton (stable reference). */
  readonly pluginSystem: PluginSystem;
  /** Session-scoped slot registry — rebuilt on every state change. */
  readonly slotRegistry: SlotRegistry;
}

// ── Context ───────────────────────────────────────────────────────────────────

const PluginCtx = createContext<PluginContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export interface PluginProviderProps {
  /**
   * The active session to derive slot state from.
   * When undefined (no active session), the registry is empty.
   */
  readonly session?: SlotSession | null;
  readonly children: ReactNode;
}

/**
 * PluginProvider — provides {@link usePluginSystem} and {@link useSlotRegistry}
 * to the widget subtree.
 *
 * Subscribes to session state reactively via `useSyncExternalStore` and
 * recomputes the slot registry whenever session state or active plugins change.
 */
export function PluginProvider({ session, children }: PluginProviderProps): ReactElement {
  // Subscribe to session state changes reactively.
  const sessionState = useSyncExternalStore(
    session?.subscribe ?? (() => () => {}),
    () => session?.getState() ?? null,
    () => session?.getState() ?? null,
  );

  // Recompute slot registry whenever state or active plugins change.
  const slotRegistry = useMemo(() => {
    if (!sessionState) return createSlotRegistry();
    const discovered = discoverSlots(sessionState, pluginSystem.activePlugins);
    return createSlotRegistry(toSlotEntries(discovered));
  }, [sessionState]);

  // Memoize context value so children don't re-render when only sessionState changes.
  const value = useMemo<PluginContextValue>(
    () => ({ pluginSystem, slotRegistry }),
    [slotRegistry],
  );

  return (
    <PluginCtx.Provider value={value}>
      {children}
    </PluginCtx.Provider>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Access the global {@link PluginSystem} singleton.
 * Must be called within a {@link PluginProvider}.
 */
export function usePluginSystem(): PluginSystem {
  const ctx = useContext(PluginCtx);
  if (!ctx) {
    throw new Error("usePluginSystem() must be used within a <PluginProvider>");
  }
  return ctx.pluginSystem;
}

/**
 * Access the session-scoped {@link SlotRegistry}.
 * The registry is rebuilt from the current session state on every state change,
 * so slots are always up to date without manual refresh calls.
 *
 * Must be called within a {@link PluginProvider}.
 */
export function useSlotRegistry(): SlotRegistry {
  const ctx = useContext(PluginCtx);
  if (!ctx) {
    throw new Error("useSlotRegistry() must be used within a <PluginProvider>");
  }
  return ctx.slotRegistry;
}
