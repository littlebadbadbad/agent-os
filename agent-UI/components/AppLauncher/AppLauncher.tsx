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
 */

import { type ReactElement, useCallback, useState } from "react";
import type { AppSlotDeclaration, SlotSession } from "@agent-type";
import { useSlotRegistry } from "../../plugin/PluginContext";
import { AppWindow } from "./AppWindow";
import styles from "./appLauncher.module.scss";

// ── Open window state ────────────────────────────────────────────────────────

interface OpenAppWindow {
  readonly pluginId: string;
  readonly slotId: string;
  readonly declaration: AppSlotDeclaration;
  readonly toolSetSymbol: symbol;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AppLauncherProps {
  /**
   * Active session for plugin state subscriptions.
   * May be null — app slots are session-independent.
   */
  readonly session?: SlotSession | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AppLauncher({ session }: AppLauncherProps): ReactElement | null {
  const { getByType } = useSlotRegistry();

  const appSlots = getByType("app")
    .slice()
    .sort((a, b) => (a.declaration.order ?? 100) - (b.declaration.order ?? 100));

  if (appSlots.length === 0) return null;

  // ── Open windows state ──────────────────────────────────────────────────

  const [windows, setWindows] = useState<readonly OpenAppWindow[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const toggleWindow = useCallback(
    (entry: OpenAppWindow) => {
      setWindows((prev) => {
        const idx = prev.findIndex((w) => w.slotId === entry.slotId);
        if (idx >= 0) {
          // Already open — close it.
          const next = prev.filter((w) => w.slotId !== entry.slotId);
          if (focusedId === entry.slotId) setFocusedId(next.length > 0 ? next[next.length - 1].slotId : null);
          return next;
        }
        // Open new window.
        setFocusedId(entry.slotId);
        return [...prev, entry];
      });
    },
    [focusedId],
  );

  const closeWindow = useCallback(
    (slotId: string) => {
      setWindows((prev) => {
        const next = prev.filter((w) => w.slotId !== slotId);
        if (focusedId === slotId) setFocusedId(next.length > 0 ? next[next.length - 1].slotId : null);
        return next;
      });
    },
    [focusedId],
  );

  const focusWindow = useCallback((slotId: string) => {
    setFocusedId(slotId);
    // Bring to front by reordering.
    setWindows((prev) => {
      const idx = prev.findIndex((w) => w.slotId === slotId);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.push(item);
      return next;
    });
  }, []);

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
          {appSlots.map((entry) => {
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
