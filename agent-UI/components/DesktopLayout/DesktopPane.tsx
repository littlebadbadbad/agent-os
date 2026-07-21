/**
 * components/DesktopLayout/DesktopPane.tsx — Left desktop panel
 *
 * Renders the desktop surface with:
 *   - App shortcut icons in a grid
 *   - Floating app windows
 *   - Taskbar at the bottom
 */

import { useReducer, useRef, type ReactElement } from "react";
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
import styles from "./DesktopPane.module.scss";

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

  return (
    <div ref={desktopRef} className={styles["desktop"]}>
      {/* App windows (floating above desktop) */}
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

      {/* Desktop shortcuts */}
      <IconsGrid
        appSlots={appSlots}
        openWindows={state.windows}
        onOpenApp={(entry: AppWindowEntry) =>
          dispatch({ type: "toggle", entry })
        }
      />

      {/* Taskbar — only shows open windows */}
      <Taskbar
        openWindows={state.windows}
        minimizedSlotIds={state.minimizedSlotIds}
        focusedSlotId={state.focusedSlotId}
        onToggleWindow={(entry: AppWindowEntry) =>
          dispatch({ type: "toggle", entry })
        }
      />
    </div>
  );
}
