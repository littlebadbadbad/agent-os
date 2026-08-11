/**
 * components/DesktopLayout/DesktopLayout.tsx — Root split-pane layout
 *
 * Full-viewport flex container that divides the screen into:
 *   - Left:  DesktopPane (app shortcuts + taskbar + floating windows)
 *   - Center: ResizeHandle (draggable divider)
 *   - Right: Sidebar (agent chat panel)
 *
 * Sidebar open/closed state is persisted in localStorage via useSidebarState.
 * When closed, the sidebar collapses to a 32px strip.
 */

import {
  type ReactElement,
  useCallback,
  useState,
} from "react";
import type { AppSlotDeclaration, SlotDeclaration, SlotSession } from "@agent-type";
import type { SlotEntry } from "../../slots/registry";
import type { WidgetIcon, WidgetTheme } from "@agent-type";
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH } from "../../constants";
import { useSidebarState } from "../../hooks/useSidebarState";
import { Sidebar } from "../Sidebar/Sidebar";
import { DesktopPane } from "./DesktopPane";
import { ResizeHandle } from "./ResizeHandle";
import styles from "./DesktopLayout.module.scss";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DesktopLayoutProps {
  /** App slots collected from the slot registry. */
  readonly appSlots: ReadonlyArray<SlotEntry<AppSlotDeclaration>>;
  /** Current session (may be null when no session is active). */
  readonly session: SlotSession | null;
  /** Unique id for sidebar state persistence. */
  readonly sidebarId?: string;
  readonly sidebarIcon?: WidgetIcon;
  readonly sidebarTheme?: WidgetTheme;
  readonly sidebarControlBar?: ReactElement;
  readonly children: ReactElement;
}

// ── Storage key ───────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH_KEY = "agent-sdk:desktop-layout:sidebar-width";

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= SIDEBAR_MIN_WIDTH) return n;
    }
  } catch {
    /* ignore */
  }
  return SIDEBAR_DEFAULT_WIDTH;
}

function saveSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DesktopLayout({
  appSlots,
  session,
  sidebarId,
  sidebarIcon,
  sidebarTheme,
  sidebarControlBar,
  children,
}: DesktopLayoutProps): ReactElement {
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth);
  const { open, setOpen } = useSidebarState(sidebarId);

  const handleResize = useCallback((width: number) => {
    setSidebarWidth(width);
    saveSidebarWidth(width);
  }, []);

  const handleToggleSidebar = useCallback(
    (nextOpen: boolean) => setOpen(nextOpen),
    [setOpen],
  );

  return (
    <div className={styles["layout"]}>
      {/* Left: Desktop */}
      <DesktopPane appSlots={appSlots} session={session} />

      {/* Center: Divider (only when sidebar is open) */}
      {open && <ResizeHandle onResize={handleResize} />}

      {/* Right: Sidebar (agent panel) */}
      <div className={styles["sidebar-panel"]} style={{ width: open ? sidebarWidth : 32 }}>
        <Sidebar
          id={sidebarId}
          icon={sidebarIcon}
          theme={sidebarTheme}
          controlBar={sidebarControlBar}
          open={open}
          onToggleOpen={handleToggleSidebar}
        >
          {children}
        </Sidebar>
      </div>
    </div>
  );
}
