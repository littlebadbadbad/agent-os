/**
 * components/DesktopLayout/DesktopPane.tsx — Left desktop panel
 *
 * Renders the desktop surface with:
 *   - App shortcut icons in a grid
 *   - Floating app windows
 *   - Taskbar at the bottom
 */

import { useCallback, useReducer, useRef, useState, type ReactElement } from "react";
import type { AppSlotDeclaration, SlotSession } from "@agent-type";
import type { SlotEntry } from "../../slots/registry";
import {
  windowReducer,
  createInitialWindowState,
  type AppWindowEntry,
} from "./windowManager";
import { IconsGrid } from "./IconsGrid";
import { Taskbar } from "./Taskbar";
import { AppWindow } from "./AppWindow";
import { PluginManagerWindow } from "../../pluginManager/PluginManagerWindow";
import styles from "./DesktopPane.module.scss";

// ── Native app window entry ───────────────────────────────────────────────────
// Used for built-in apps rendered outside the plugin slot system.

interface NativeWindowState {
  readonly open: boolean;
  readonly minimized: boolean;
  readonly focused: boolean;
}

export interface DesktopPaneProps {
  readonly appSlots: ReadonlyArray<SlotEntry<AppSlotDeclaration>>;
  readonly session: SlotSession | null;
}

export function DesktopPane({
  appSlots,
  session,
}: DesktopPaneProps): ReactElement {
  const [state, dispatch] = useReducer(
    windowReducer,
    undefined,
    createInitialWindowState,
  );

  const [nativeWindows, setNativeWindows] = useState<
    Record<string, NativeWindowState>
  >({
    "plugin-manager": { open: false, minimized: false, focused: false },
  });

  const desktopRef = useRef<HTMLDivElement>(null);

  // ── Native window helpers ───────────────────────────────────────────────

  const openNativeWindow = useCallback((id: string) => {
    setNativeWindows((prev) => ({
      ...prev,
      [id]: { open: true, minimized: false, focused: true },
    }));
  }, []);

  const closeNativeWindow = useCallback((id: string) => {
    setNativeWindows((prev) => ({
      ...prev,
      [id]: { open: false, minimized: false, focused: false },
    }));
  }, []);

  const focusNativeWindow = useCallback((id: string) => {
    setNativeWindows((prev) => ({
      ...prev,
      [id]: { ...prev[id], focused: true },
    }));
  }, []);

  const minimizeNativeWindow = useCallback((id: string) => {
    setNativeWindows((prev) => ({
      ...prev,
      [id]: { ...prev[id], minimized: true, focused: false },
    }));
  }, []);

  // Count open native windows for taskbar
  const openNativeEntries: Array<{ slotId: string; label: string; icon: string }> = [];
  for (const [id, win] of Object.entries(nativeWindows)) {
    if (win.open) {
      if (id === "plugin-manager") {
        openNativeEntries.push({ slotId: id, label: "Plugin Manager", icon: "🧩" });
      }
    }
  }

  const pmWin = nativeWindows["plugin-manager"];

  return (
    <div ref={desktopRef} className={styles["desktop"]}>
      {/* Slot-based app windows */}
      {state.windows.map((entry, idx) => {
        const isMinimized = state.minimizedSlotIds.has(entry.slotId);
        return (
          <AppWindow
            key={entry.slotId}
            pluginId={entry.pluginId}
            slotId={entry.slotId}
            declaration={entry.declaration}
            session={session}
            toolSetSymbol={entry.toolSetSymbol}
            containerRef={desktopRef}
            onClose={() => dispatch({ type: "close", slotId: entry.slotId })}
            onFocus={() => dispatch({ type: "focus", slotId: entry.slotId })}
            onMinimize={() =>
              dispatch({ type: "minimize", slotId: entry.slotId })
            }
            zIndex={10000 + idx}
            isFocused={state.focusedSlotId === entry.slotId && !isMinimized}
            isMinimized={isMinimized}
          />
        );
      })}

      {/* Native Plugin Manager window */}
      {pmWin.open && (
        <PluginManagerWindow
          containerRef={desktopRef}
          onClose={() => closeNativeWindow("plugin-manager")}
          onFocus={() => focusNativeWindow("plugin-manager")}
          onMinimize={() => minimizeNativeWindow("plugin-manager")}
          zIndex={10000 + state.windows.length + 1}
          isFocused={pmWin.focused}
          isMinimized={pmWin.minimized}
        />
      )}

      {/* Desktop shortcuts */}
      <IconsGrid
        appSlots={appSlots}
        openWindows={state.windows}
        onOpenApp={(entry: AppWindowEntry) =>
          dispatch({ type: "toggle", entry })
        }
      />

      {/* Native Plugin Manager icon (always visible) */}
      <button
        type="button"
        className={styles["native-icon"]}
        onDoubleClick={() => {
          if (pmWin.open && !pmWin.minimized) {
            closeNativeWindow("plugin-manager");
          } else {
            openNativeWindow("plugin-manager");
          }
        }}
        title="Open Plugin Manager"
        aria-label="Open Plugin Manager"
      >
        <span className={styles["native-icon-emoji"]}>🧩</span>
        <span className={styles["native-icon-label"]}>Plugin Manager</span>
      </button>

      {/* Taskbar */}
      <Taskbar
        openWindows={[...state.windows, ...openNativeEntries.map((e) => ({
          pluginId: "native",
          slotId: e.slotId,
          declaration: { type: "app" as const, icon: e.icon, label: e.label },
          toolSetSymbol: Symbol.for(e.slotId),
        }))]}
        minimizedSlotIds={
          new Set([
            ...state.minimizedSlotIds,
            ...Object.entries(nativeWindows)
              .filter(([, w]) => w.open && w.minimized)
              .map(([id]) => id),
          ])
        }
        focusedSlotId={
          state.focusedSlotId ??
          Object.entries(nativeWindows).find(([, w]) => w.focused)?.[0] ??
          null
        }
        onToggleWindow={(entry: AppWindowEntry) => {
          if (entry.pluginId === "native") {
            const id = entry.slotId;
            const win = nativeWindows[id];
            if (win.open && !win.minimized) {
              minimizeNativeWindow(id);
            } else {
              openNativeWindow(id);
            }
          } else {
            dispatch({ type: "toggle", entry });
          }
        }}
      />
    </div>
  );
}
