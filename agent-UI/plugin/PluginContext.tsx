/**
 * agent-UI/plugin/PluginContext.tsx — React Provider + hooks for plugin system
 *
 * Slot declarations are now stored independently from session state (populated
 * at plugin activation time via `host.registerToolSet(toolSet, slots)`).
 * The registry is always populated regardless of whether a session exists,
 * enabling slot types like `toolButton` to appear even without an active session.
 *
 * Session state is still subscribed to reactively so that slot display callbacks
 * can read the current toolset state.
 *
 *   - {@link PluginProvider} wraps the widget content, collects standalone slot
 *     declarations from active plugins, and builds a read-only
 *     {@link SlotRegistry} — no session dependency required.
 *   - {@link usePluginSystem} returns the global {@link PluginSystem} singleton.
 *   - {@link useSlotRegistry} returns the session-scoped {@link SlotRegistry}.
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
import type { SlotSession, PluginStateExtension } from "@agent-type";
import { createSlotRegistry, type SlotRegistry } from "../slots/registry";
import { collectStandaloneSlots, toSlotEntries } from "./discoverSlots";
import { pluginSystem } from "@agent-UI/agents";
import type { PluginSystem } from "./pluginSystem";

// ── Context value ─────────────────────────────────────────────────────────────

interface PluginContextValue {
  /** Global plugin system singleton (stable reference). */
  readonly pluginSystem: PluginSystem;
  /** Slot registry — always populated from standalone slot declarations. */
  readonly slotRegistry: SlotRegistry;
  /**
   * Current session state, or null when no session is active.
   * Passed to slot display callbacks so they can read the toolset's state.
   */
  readonly sessionState: Record<string | symbol, unknown> | null;
}

// ── Context ───────────────────────────────────────────────────────────────────

const PluginCtx = createContext<PluginContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export interface PluginProviderProps {
  /**
   * The active session to derive toolset state from.
   * When undefined, slot callbacks receive `undefined` state.
   */
  readonly session?: SlotSession | null;
  readonly children: ReactNode;
}

/**
 * PluginProvider — provides {@link usePluginSystem} and {@link useSlotRegistry}
 * to the widget subtree.
 *
 * Slot declarations are collected from standalone plugin registries (no session
 * dependency). Session state is subscribed to reactively so slot display
 * callbacks can read the current toolset state.
 */
export function PluginProvider({ session, children }: PluginProviderProps): ReactElement {
  // Subscribe to session state changes reactively.
  const rawState = useSyncExternalStore(
    session?.subscribe ?? (() => () => {}),
    () => session?.getState() ?? null,
    () => session?.getState() ?? null,
  );

  const sessionState = rawState as Record<string | symbol, unknown> | null;

  // Build slot registry from standalone declarations (always available).
  const slotRegistry = useMemo(() => {
    const discovered = collectStandaloneSlots(pluginSystem.activePlugins);
    return createSlotRegistry(toSlotEntries(discovered));
  }, []);

  // Memoize context value.
  const value = useMemo<PluginContextValue>(
    () => ({ pluginSystem, slotRegistry, sessionState }),
    [slotRegistry, sessionState],
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
 * Slots are always available regardless of session state.
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

/**
 * Resolve a ToolSet's symbol state from the current session state.
 * Returns the state slice for the given symbol, or `undefined` when
 * no session is active or the symbol is not found.
 *
 * Slot display callbacks use this to receive toolset state as their
 * second parameter.
 *
 * @param toolSetSymbol The ToolSet's symbol to look up.
 * @returns The toolset's state contribution, or `undefined`.
 */
export function useToolSetState(
  toolSetSymbol: symbol,
): PluginStateExtension | undefined {
  const ctx = useContext(PluginCtx);
  if (!ctx) return undefined;
  if (!ctx.sessionState) return undefined;
  const state = ctx.sessionState[toolSetSymbol];
  return state as PluginStateExtension | undefined;
}
