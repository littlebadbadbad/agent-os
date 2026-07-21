/**
 * components/DesktopLayout/ResizeHandle.tsx — Draggable divider
 *
 * Renders a thin vertical bar between desktop and sidebar panes.
 * Drag to resize the sidebar width.
 */

import { useCallback, useRef, type ReactElement } from "react";
import styles from "./ResizeHandle.module.scss";

export interface ResizeHandleProps {
  /** Called on every drag move with the new sidebar width in px. */
  readonly onResize: (sidebarWidth: number) => void;
}

export function ResizeHandle({ onResize }: ResizeHandleProps): ReactElement {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: 0 };

      function onMove(ev: MouseEvent) {
        const d = dragRef.current;
        if (!d) return;
        const maxW = Math.floor(window.innerWidth * 0.8);
        const sidebarW = Math.max(280, Math.min(maxW, window.innerWidth - ev.clientX));
        onResize(sidebarW);
      }

      function onUp() {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onResize],
  );

  return (
    <div
      className={styles["handle"]}
      onMouseDown={handleMouseDown}
      aria-label="Resize sidebar"
      role="separator"
      aria-orientation="vertical"
    />
  );
}
