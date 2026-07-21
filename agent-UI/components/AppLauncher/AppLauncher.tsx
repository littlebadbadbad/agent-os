/**
 * agent-UI/components/AppLauncher/AppLauncher.tsx
 *
 * A Windows-style app launcher taskbar, rendered at the bottom of the viewport.
 *
 * Reads `app` slot declarations from the slot registry and renders one icon per
 * app slot.  Clicking an icon opens a floating {@link AppWindow}.
 *
 * Session-independent — the taskbar and its windows render even without an
 * active chat session.  Plugin display callbacks receive empty context and
 * undefined state when no session exists.
 *
 * Session is read from {@link PluginContext} automatically — no prop needed.
 */

import { type ReactElement, useCallback, useReducer, useSyncExternalStore } from "react";
import type { AppSlotDeclaration } from "@agent-type";
import { useSlotRegistry, useSession } from "../../plugin/PluginContext";
import { AppWindow } from "./AppWindow";
import styles from "./appLauncher.module.scss";

// ── Window manager types ─────────────────────────────────────────────────────

interface OpenAppWindow {
  readonly pluginId: string;
  readonly slotId: string;
  readonly declaration: AppSlotDeclaration;
  readonly toolSetSymbol: symbol;
}

interface WindowManagerState {
  readonly windows: readonly OpenAppWindow[];
  readonly focusedId: string | null;
}

type WindowAction =
  | { readonly type: "toggle"; readonly entry: OpenAppWindow }
  | { readonly type: "close"; readonly slotId: string }
  | { readonly type: "focus"; readonly slotId: string };

function windowManagerReducer(
  state: WindowManagerState,
  action: WindowAction,
): WindowManagerState {
  switch (action.type) {
    case "toggle": {
      const idx = state.windows.findIndex((w) => w.slotId === action.entry.slotId);
      if (idx >= 0) {
        // Close the window.
        const next = state.windows.filter((_, i) => i !== idx);
        return {
          windows: next,
          focusedId:
            state.focusedId === action.entry.slotId
              ? next.length > 0
                ? next[next.length - 1].slotId
                : null
              : state.focusedId,
        };
      }
      // Open a new window.
      return {
        windows: [...state.windows, action.entry],
        focusedId: action.entry.slotId,
      };
    }
    case "close": {
      const next = state.windows.filter((w) => w.slotId !== action.slotId);
      return {
        windows: next,
        focusedId:
          state.focusedId === action.slotId
            ? next.length > 0
              ? next[next.length - 1].slotId
              : null
            : state.focusedId,
      };
    }
    case "focus": {
      const idx = state.windows.findIndex((w) => w.slotId === action.slotId);
      if (idx < 0) return state;
      // Bring to front by moving to end of array (highest z-index).
      if (idx === state.windows.length - 1) {
        return { ...state, focusedId: action.slotId };
      }
      const reordered = [...state.windows];
      const [item] = reordered.splice(idx, 1);
      reordered.push(item);
      return { windows: reordered, focusedId: action.slotId };
    }
  }
}

// ── Props (empty — session is read from context) ──────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AppLauncherProps {
  // No props needed — session is read from PluginContext.
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Evaluate the `shouldRender` callback for an app slot.
 * Returns `true` when the slot should appear in the taskbar.
 */
function appSlotShouldRender(
  declaration: AppSlotDeclaration,
  sessionState: { readonly id: string; readonly agentName: string; readonly conversationId: string } | null,
): boolean {
  if (!declaration.shouldRender) return true;
  if (!sessionState) {
    return declaration.shouldRender(
      { sessionId: "", agentName: "", conversationId: "" },
      undefined,
    );
  }
  return declaration.shouldRender(
    { sessionId: sessionState.id, agentName: sessionState.agentName, conversationId: sessionState.conversationId },
    undefined,
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AppLauncher(_props: AppLauncherProps): ReactElement | null {
  const { getByType } = useSlotRegistry();
  const session = useSession();

  const appSlots = getByType("app")
    .slice()
    .sort((a, b) => (a.declaration.order ?? 100) - (b.declaration.order ?? 100));

  // Build session context for shouldRender evaluation.
  const sessionContext = useSyncExternalStore(
    session?.subscribe ?? (() => () => {}),
    () => session?.getState() ?? null,
    () => session?.getState() ?? null,
  );

  // Filter slots whose shouldRender returns false.
  const visibleSlots = sessionContext
    ? appSlots.filter((e) => appSlotShouldRender(e.declaration, sessionContext))
    : appSlots.filter((e) => appSlotShouldRender(e.declaration, null));

  if (visibleSlots.length === 0) return null;

  // ── Window manager: reducer keeps windows + focusedId in sync ───────────
  // A single reducer eliminates stale closure issues — all state transitions
  // are pure and atomic.

  const [{ windows, focusedId }, dispatch] = useReducer(windowManagerReducer, {
    windows: [],
    focusedId: null,
  });

  const toggleWindow = useCallback(
    (entry: OpenAppWindow) => dispatch({ type: "toggle", entry }),
    [],
  );

  const closeWindow = useCallback(
    (slotId: string) => dispatch({ type: "close", slotId }),
    [],
  );

  const focusWindow = useCallback(
    (slotId: string) => dispatch({ type: "focus", slotId }),
    [],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* App windows (rendered outside taskbar, at viewport level) */}
      {windows.map((w, idx) => (
        <AppWindow
          key={w.slotId}
          pluginId={w.pluginId}
          slotId={w.slotId}
          declaration={w.declaration}
          session={session}
          toolSetSymbol={w.toolSetSymbol}
          onClose={() => closeWindow(w.slotId)}
          onFocus={() => focusWindow(w.slotId)}
          zIndex={10000 + idx}
          isFocused={focusedId === w.slotId}
        />
      ))}

      {/* Taskbar */}
      <div className={styles["taskbar"]}>
        <div className={styles["taskbar-apps"]}>
          {visibleSlots.map((entry) => {
            const isOpen = windows.some((w) => w.slotId === entry.slotId);
            return (
              <button
                key={entry.slotId}
                type="button"
                className={`${styles["taskbar-icon"]}${isOpen ? ` ${styles["taskbar-icon--active"]}` : ""}`}
                onClick={() =>
                  toggleWindow({
                    pluginId: entry.pluginId,
                    slotId: entry.slotId,
                    declaration: entry.declaration,
                    toolSetSymbol: entry.toolSetSymbol,
                  })
                }
                title={entry.declaration.label}
                aria-label={`Toggle ${entry.declaration.label}`}
              >
                <span className={styles["taskbar-icon-emoji"]}>{entry.declaration.icon}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
