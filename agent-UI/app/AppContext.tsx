/**
 * agent-UI/app/AppContext.tsx — React Provider + hooks for app system
 *
 * Slot declarations are collected from standalone app registries (no session
 * dependency) and reactively update when apps are activated/deactivated.
 * Session state is subscribed to reactively so slot display callbacks can read
 * the current toolset state.
 *
 * The context carries the raw `SlotSession` object so session-independent
 * components (like AppLauncher) can pass it down to their slot renderers
 * without needing a redundant prop.
 *
 * Usage:
 * ```tsx
 * <AppProvider session={activeSession}>
 *   <AIControlBar />
 *   <SessionContent />
 *   <AppLauncher />
 * </AppProvider>
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
import type { SlotSession, AppStateExtension, SessionStateLike } from "@agent-type";
import { createSlotRegistry, type SlotRegistry } from "../slots/registry";
import { collectStandaloneSlots, toSlotEntries } from "./discoverSlots";
import { appSystem } from "@agent-UI/agents";
import type { AppSystem } from "./appSystem";

// ── Context value ─────────────────────────────────────────────────────────────

interface AppContextValue {
  /** Global app system singleton (stable reference). */
  readonly appSystem: AppSystem;
  /** Slot registry — reactively rebuilt when apps change. */
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

const AppCtx = createContext<AppContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export interface AppProviderProps {
  /**
   * The active session to derive toolset state from.
   * When null/undefined, slot callbacks receive `undefined` state.
   */
  readonly session?: SlotSession | null;
  readonly children: ReactNode;
}

/**
 * AppProvider — provides {@link useAppSystem}, {@link useSlotRegistry},
 * and {@link useSession} to the widget subtree.
 *
 * Slot declarations are collected from standalone app registries and
 * reactively rebuilt when apps are activated/deactivated. Session state
 * is subscribed to via `useSyncExternalStore`.
 */
export function AppProvider({ session, children }: AppProviderProps): ReactElement {
  // Subscribe to session state changes reactively.
  const sessionState = useSyncExternalStore(
    session?.subscribe ?? (() => () => {}),
    () => session?.getState() ?? null,
    () => session?.getState() ?? null,
  );

  // Build slot registry from standalone declarations — reactively rebuilt
  // when apps are activated/deactivated via the subscribe mechanism.
  const [slotRegistry, setSlotRegistry] = useState<SlotRegistry>(() => {
    const discovered = collectStandaloneSlots(appSystem.activeApps);
    return createSlotRegistry(toSlotEntries(discovered));
  });

  useEffect(() => {
    return appSystem.subscribe(() => {
      const discovered = collectStandaloneSlots(appSystem.activeApps);
      setSlotRegistry(createSlotRegistry(toSlotEntries(discovered)));
    });
  }, []);

  // Memoize context value with stable references.
  // Note: sessionState is included for reactive re-renders — useSyncExternalStore
  // guarantees it's a stable reference until the underlying state changes.
  const value = useMemo<AppContextValue>(
    () => ({ appSystem, slotRegistry, session: session ?? null, sessionState }),
    [slotRegistry, session, sessionState],
  );

  return (
    <AppCtx.Provider value={value}>
      {children}
    </AppCtx.Provider>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Access the global {@link AppSystem} singleton.
 * Must be called within a {@link AppProvider}.
 */
export function useAppSystem(): AppSystem {
  const ctx = useContext(AppCtx);
  if (!ctx) {
    throw new Error("useAppSystem() must be used within a <AppProvider>");
  }
  return ctx.appSystem;
}

/**
 * Access the reactively updated {@link SlotRegistry}.
 * Slots are always available regardless of session state.
 *
 * Must be called within a {@link AppProvider}.
 */
export function useSlotRegistry(): SlotRegistry {
  const ctx = useContext(AppCtx);
  if (!ctx) {
    throw new Error("useSlotRegistry() must be used within a <AppProvider>");
  }
  return ctx.slotRegistry;
}

/**
 * Access the current session object from context.
 * Returns `null` when no session is active.
 *
 * Must be called within a {@link AppProvider}.
 */
export function useSession(): SlotSession | null {
  const ctx = useContext(AppCtx);
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
): AppStateExtension | undefined {
  const ctx = useContext(AppCtx);
  if (!ctx?.sessionState) return undefined;
  const toolState: AppStateExtension | undefined = ctx.sessionState[toolSetSymbol];
  return toolState;
}
