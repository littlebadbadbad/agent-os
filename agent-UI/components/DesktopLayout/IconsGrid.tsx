/**
 * components/DesktopLayout/IconsGrid.tsx — Desktop app shortcut icons
 *
 * Renders app slot icons in a grid on the desktop surface.
 * Double-click to open the app window.
 */

import { memo, type ReactElement } from "react";
import type { AppSlotDeclaration, SlotDeclaration } from "@agent-type";
import type { SlotEntry } from "../../slots/registry";
import type { AppWindowEntry } from "./windowManager";
import styles from "./IconsGrid.module.scss";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface IconsGridProps {
  readonly appSlots: ReadonlyArray<SlotEntry<AppSlotDeclaration>>;
  readonly openWindows: readonly AppWindowEntry[];
  readonly onOpenApp: (entry: AppWindowEntry) => void;
}

// ── DesktopIcon (memoised sub-component) ──────────────────────────────────────

interface DesktopIconProps {
  readonly slot: SlotEntry<AppSlotDeclaration>;
  readonly isOpen: boolean;
  readonly onOpen: () => void;
}

const DesktopIcon = memo(function DesktopIcon({
  slot,
  isOpen,
  onOpen,
}: DesktopIconProps): ReactElement {
  return (
    <button
      type="button"
      className={`${styles["desktop-icon"]}${isOpen ? ` ${styles["desktop-icon--open"]}` : ""}`}
      onDoubleClick={onOpen}
      title={`Open ${slot.declaration.label}`}
      aria-label={`Open ${slot.declaration.label}`}
    >
      <span className={styles["desktop-icon-emoji"]}>{slot.declaration.icon}</span>
      <span className={styles["desktop-icon-label"]}>{slot.declaration.label}</span>
    </button>
  );
});

// ── IconsGrid ─────────────────────────────────────────────────────────────────

export function IconsGrid({
  appSlots,
  openWindows,
  onOpenApp,
}: IconsGridProps): ReactElement {
  if (appSlots.length === 0) {
    return (
      <div className={styles["empty"]}>
        <div className={styles["empty-icon"]}>🖥️</div>
        <div className={styles["empty-text"]}>Desktop</div>
        <div className={styles["empty-hint"]}>
          Install a app with app slots to see icons here.
        </div>
      </div>
    );
  }

  return (
    <div className={styles["grid"]}>
      {appSlots.map((slot) => {
        const isOpen = openWindows.some((w) => w.slotId === slot.slotId);
        return (
          <DesktopIcon
            key={slot.slotId}
            slot={slot}
            isOpen={isOpen}
            onOpen={() =>
              onOpenApp({
                appId: slot.appId,
                slotId: slot.slotId,
                declaration: slot.declaration,
                toolSetSymbol: slot.toolSetSymbol,
              })
            }
          />
        );
      })}
    </div>
  );
}
