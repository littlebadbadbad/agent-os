/**
 * components/DesktopLayout/DesktopPane.tsx — Left desktop panel
 *
 * Renders the desktop surface with:
 *   - App shortcut icons in a grid (plugin slots + native apps)
 *   - Floating app windows (slot-based and native)
 *   - Taskbar at the bottom
 *
 * ALL windows — both plugin slots and native built-in apps — share the same
 * `windowReducer` state.  Native apps are defined in `nativeApps.tsx` and
 * auto-discoverable by IconsGrid, Taskbar, and the window manager.
 * Adding a new native app: just push another entry to NATIVE_APPS.
 */

import { useCallback, useReducer, useRef, type ReactElement } from "react";
import type { AppSlotDeclaration, SlotSession } from "@agent-type";
import type { SlotEntry } from "../../slots/registry";
import {
  windowReducer,
  createInitialWindowState,
  type AppWindowEntry,
} from "./windowManager";
import {
  NATIVE_APPS,
  NATIVE_PLUGIN_ID,
  type NativeAppDefinition,
} from "./nativeApps";
import { IconsGrid } from "./IconsGrid";
import { Taskbar } from "./Taskbar";
import { AppWindow } from "./AppWindow";
import styles from "./DesktopPane.module.scss";

// ── Build virtual SlotEntry for each native app so IconsGrid renders them ────

function nativeAppToSlotEntry(def: NativeAppDefinition): SlotEntry<AppSlotDeclaration> {
  return {
    pluginId: NATIVE_PLUGIN_ID,
    slotId: def.slotId,
    declaration: def.declaration,
    toolSetSymbol: Symbol.for(def.slotId),
  };
}

const NATIVE_SLOT_ENTRIES: ReadonlyArray<SlotEntry<AppSlotDeclaration>> =
  NATIVE_APPS.map(nativeAppToSlotEntry);

/** SlotId → NativeAppDefinition lookup — built once, used for AppWindow renderContent. */
const NATIVE_DEF_MAP: ReadonlyMap<string, NativeAppDefinition> = new Map(
  NATIVE_APPS.map((d) => [d.slotId, d] as const),
);

// ── Props ────────────────────────────────────────────────────────────────────

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

  const desktopRef = useRef<HTMLDivElement>(null);

  // Merge plugin-slot entries and native entries for toggle dispatch.
  // Native entries are built once and cached — they never change at runtime.
  const handleOpenApp = useCallback((entry: AppWindowEntry) => {
    dispatch({ type: "toggle", entry });
  }, []);

  return (
    <div ref={desktopRef} className={styles["desktop"]}>
      {/* App windows — both slot-based and native */}
      {state.windows.map((entry, idx) => {
        const isMinimized = state.minimizedSlotIds.has(entry.slotId);
        const nativeDef = NATIVE_DEF_MAP.get(entry.slotId);
        return (
          <AppWindow
            key={entry.slotId}
            pluginId={entry.pluginId}
            slotId={entry.slotId}
            declaration={entry.declaration}
            session={session}
            toolSetSymbol={entry.toolSetSymbol}
            containerRef={desktopRef}
            renderContent={
              nativeDef
                ? () => nativeDef.renderContent(() => dispatch({ type: "close", slotId: entry.slotId }))
                : undefined
            }
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

      {/* Desktop shortcuts — plugin slots + native apps */}
      <IconsGrid
        appSlots={[...NATIVE_SLOT_ENTRIES, ...appSlots]}
        openWindows={state.windows}
        onOpenApp={handleOpenApp}
      />

      {/* Taskbar — all open windows */}
      <Taskbar
        openWindows={state.windows}
        minimizedSlotIds={state.minimizedSlotIds}
        focusedSlotId={state.focusedSlotId}
        onToggleWindow={(entry: AppWindowEntry) => {
          dispatch({ type: "toggle", entry });
        }}
      />
    </div>
  );
}
