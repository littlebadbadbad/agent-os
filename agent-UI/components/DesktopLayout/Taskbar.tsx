/**
 * components/DesktopLayout/Taskbar.tsx — Windows-style bottom taskbar
 *
 * Shows one icon per open app window. Clicking toggles focus/minimize/restore.
 * Only open apps appear — unlike the desktop IconsGrid which shows all slots.
 */

import { memo, type ReactElement } from "react";
import type { AppWindowEntry } from "./windowManager";
import styles from "./Taskbar.module.scss";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TaskbarProps {
  readonly openWindows: readonly AppWindowEntry[];
  readonly minimizedSlotIds: ReadonlySet<string>;
  readonly focusedSlotId: string | null;
  readonly onToggleWindow: (entry: AppWindowEntry) => void;
}

// ── TaskbarIcon (memoised sub-component avoids hooks-in-loop) ─────────────────

interface TaskbarIconProps {
  readonly entry: AppWindowEntry;
  readonly isActive: boolean;
  readonly isMinimized: boolean;
  readonly onToggle: () => void;
}

const TaskbarIcon = memo(function TaskbarIcon({
  entry,
  isActive,
  isMinimized,
  onToggle,
}: TaskbarIconProps): ReactElement {
  const classes = [
    styles["taskbar-icon"],
    styles["taskbar-icon--open"],
    isActive ? styles["taskbar-icon--active"] : "",
    isMinimized ? styles["taskbar-icon--minimized"] : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      onClick={onToggle}
      title={entry.declaration.label}
      aria-label={entry.declaration.label}
    >
      <span className={styles["taskbar-icon-emoji"]}>
        {entry.declaration.icon}
      </span>
    </button>
  );
});

// ── Taskbar ───────────────────────────────────────────────────────────────────

export function Taskbar({
  openWindows,
  minimizedSlotIds,
  focusedSlotId,
  onToggleWindow,
}: TaskbarProps): ReactElement {
  if (openWindows.length === 0) return <div className={styles["taskbar"]} />;

  return (
    <div className={styles["taskbar"]}>
      <div className={styles["taskbar-apps"]}>
        {openWindows.map((entry) => {
          const isMinimized = minimizedSlotIds.has(entry.slotId);
          const isActive = focusedSlotId === entry.slotId && !isMinimized;

          return (
            <TaskbarIcon
              key={entry.slotId}
              entry={entry}
              isActive={isActive}
              isMinimized={isMinimized}
              onToggle={() => onToggleWindow(entry)}
            />
          );
        })}
      </div>
    </div>
  );
}
