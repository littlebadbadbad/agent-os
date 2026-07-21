/**
 * agent-UI/plugin/PluginContext.tsx — React Provider + hooks for plugin system
 *
 * Slot declarations are collected from standalone plugin registries (no session
 * dependency) and reactively update when plugins are activated/deactivated.
 * Session state is subscribed to reactively so slot display callbacks can read
 * the current toolset state.
 *
 * The context carries the raw `SlotSession` object so session-independent
 * components (like AppLauncher) can pass it down to their slot renderers
 * without needing a redundant prop.
 *
 * Usage:
 * ```tsx
 * <PluginProvider session={activeSession}>
 *   <AIControlBar />
 *   <SessionContent />
 *   <AppLauncher />
 * </PluginProvider>
 * ```
 *
 * Inside any descendant:
 * ```tsx
 * const { getByType } = useSlotRegistry();
 * const session = useSession();
 * const toolbarState = useToolSetState(toolbarSymbol);
 * ```
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactElement,
  type ReactNode,
} from "react";
import { useSyncExternalStore } from "react";
import type { SlotSession, PluginStateExtension, SessionStateLike } from "@agent-type";
import { createSlotRegistry, type SlotRegistry } from "../slots/registry";
import { collectStandaloneSlots, toSlotEntries } from "./discoverSlots";
import { pluginSystem } from "@agent-UI/agents";
import type { PluginSystem } from "./pluginSystem";

// ── Context value ─────────────────────────────────────────────────────────────

interface PluginContextValue {
  /** Global plugin system singleton (stable reference). */
  readonly pluginSystem: PluginSystem;
  /** Slot registry — reactively rebuilt when plugins change. */
  readonly slotRegistry: SlotRegistry;
  /**
   * The raw session object, or null when no session is active.
   * Components that need to pass session down to slot renderers
   * (e.g. AppLauncher → AppWindow → SlotRenderer) read this directly.
   */
  readonly session: SlotSession | null;
  /**
   * Current session state snapshot, or null when no session is active.
   * Provides reactive updates — components subscribing to this via
   * context will re-render on every session state change.
   */
  readonly sessionState: SessionStateLike | null;
}

// ── Context ───────────────────────────────────────────────────────────────────

const PluginCtx = createContext<PluginContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export interface PluginProviderProps {
  /**
   * The active session to derive toolset state from.
   * When null/undefined, slot callbacks receive `undefined` state.
   */
  readonly session?: SlotSession | null;
  readonly children: ReactNode;
}

/**
 * PluginProvider — provides {@link usePluginSystem}, {@link useSlotRegistry},
 * and {@link useSession} to the widget subtree.
 *
 * Slot declarations are collected from standalone plugin registries and
 * reactively rebuilt when plugins are activated/deactivated. Session state
 * is subscribed to via `useSyncExternalStore`.
 */
export function PluginProvider({ session, children }: PluginProviderProps): ReactElement {
  // Subscribe to session state changes reactively.
  const sessionState = useSyncExternalStore(
    session?.subscribe ?? (() => () => {}),
    () => session?.getState() ?? null,
    () => session?.getState() ?? null,
  );

  // Build slot registry from standalone declarations — reactively rebuilt
  // when plugins are activated/deactivated via the subscribe mechanism.
  const [slotRegistry, setSlotRegistry] = useState<SlotRegistry>(() => {
    const plugins = pluginSystem.activePlugins;
    const discovered = collectStandaloneSlots(plugins);
    console.log(
      `[PluginProvider] activePlugins=${plugins.length}, discovered=${discovered.length}`,
      plugins.map((p) => `${p.id} slots=${p.slotDeclarations.size}`).join(', '),
      discovered.map((d) => `${d.pluginId}:${d.declaration.type}`).join(', '),
    );
    return createSlotRegistry(toSlotEntries(discovered));
  });

  useEffect(() => {
    return pluginSystem.subscribe(() => {
      const discovered = collectStandaloneSlots(pluginSystem.activePlugins);
      setSlotRegistry(createSlotRegistry(toSlotEntries(discovered)));
    });
  }, []);

  // Memoize context value with stable references.
  // Note: sessionState is included for reactive re-renders — useSyncExternalStore
  // guarantees it's a stable reference until the underlying state changes.
  const value = useMemo<PluginContextValue>(
    () => ({ pluginSystem, slotRegistry, session: session ?? null, sessionState }),
    [slotRegistry, session, sessionState],
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
 * Access the reactively updated {@link SlotRegistry}.
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
 * Access the current session object from context.
 * Returns `null` when no session is active.
 *
 * Must be called within a {@link PluginProvider}.
 */
export function useSession(): SlotSession | null {
  const ctx = useContext(PluginCtx);
  if (!ctx) return null;
  return ctx.session;
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
  if (!ctx?.sessionState) return undefined;
  const toolState: PluginStateExtension | undefined = ctx.sessionState[toolSetSymbol];
  return toolState;
}
