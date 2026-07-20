/**
 * agent-UI/components/AppLauncher/AppWindow.tsx
 *
 * A floating, draggable, resizable window that hosts a plugin slot iframe.
 * Modeled after a Windows application window: title bar with icon + label,
 * close/minimize buttons, draggable, resizable via edges.
 *
 * Session may be null — app windows render independently of chat sessions.
 */

import { type ReactElement, useCallback, useRef, useState } from "react";
import { SlotRenderer } from "../../slots/SlotRenderer";
import type { AppSlotDeclaration, SlotSession } from "@agent-type";
import styles from "./appLauncher.module.scss";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_WIDTH = 600;
const DEFAULT_WINDOW_HEIGHT = 400;
const MIN_WINDOW_WIDTH = 200;
const MIN_WINDOW_HEIGHT = 150;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AppWindowProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly declaration: AppSlotDeclaration;
  readonly session?: SlotSession | null;
  readonly toolSetSymbol: symbol;
  readonly onClose: () => void;
  readonly onFocus: () => void;
  readonly zIndex: number;
  readonly isFocused: boolean;
}

// ── Position state ────────────────────────────────────────────────────────────

interface WindowPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AppWindow({
  pluginId,
  slotId,
  declaration,
  session,
  toolSetSymbol,
  onClose,
  onFocus,
  zIndex,
  isFocused,
}: AppWindowProps): ReactElement {
  // Centre on first open.
  const [pos, setPos] = useState<WindowPosition>(() => {
    const w = declaration.defaultWidth ?? DEFAULT_WINDOW_WIDTH;
    const h = declaration.defaultHeight ?? DEFAULT_WINDOW_HEIGHT;
    return {
      x: Math.max(0, Math.round((window.innerWidth - w) / 2)),
      y: Math.max(0, Math.round((window.innerHeight - h) / 3)),
      width: w,
      height: h,
    };
  });

  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; edge: string } | null>(null);

  // ── Drag (title bar) ─────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onFocus();
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

      function onMove(ev: MouseEvent) {
        const d = dragRef.current;
        if (!d) return;
        setPos((p) => ({
          ...p,
          x: d.origX + (ev.clientX - d.startX),
          y: d.origY + (ev.clientY - d.startY),
        }));
      }

      function onUp() {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onFocus, pos.x, pos.y],
  );

  // ── Resize (edges) ───────────────────────────────────────────────────────

  const handleResizeStart = useCallback(
    (edge: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: pos.width, origH: pos.height, edge };

      function onMove(ev: MouseEvent) {
        const r = resizeRef.current;
        if (!r) return;
        const dx = ev.clientX - r.startX;
        const dy = ev.clientY - r.startY;
        setPos((p) => {
          let { x, y, width, height } = p;
          if (r.edge.includes("e")) width = Math.max(MIN_WINDOW_WIDTH, r.origW + dx);
          if (r.edge.includes("w")) { width = Math.max(MIN_WINDOW_WIDTH, r.origW - dx); x = r.startX + r.origW - width; }
          if (r.edge.includes("s")) height = Math.max(MIN_WINDOW_HEIGHT, r.origH + dy);
          if (r.edge.includes("n")) { height = Math.max(MIN_WINDOW_HEIGHT, r.origH - dy); y = r.startY + r.origH - height; }
          return { x, y, width, height };
        });
      }

      function onUp() {
        resizeRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pos.x, pos.y, pos.width, pos.height],
  );

  const resizable = declaration.resizable ?? true;
  const minimizable = declaration.minimizable ?? true;

  // ── Render ───────────────────────────────────────────────────────────────

  const windowStyle: Record<string, string | number | undefined> = {
    left: pos.x,
    top: pos.y,
    width: pos.width,
    height: pos.height,
    zIndex,
    display: minimized ? "none" : undefined,
  };

  return (
    <div
      className={`${styles["window"]}${isFocused ? ` ${styles["window--focused"]}` : ""}`}
      style={windowStyle}
      onMouseDown={onFocus}
    >
      {/* Resize edges */}
      {resizable && (
        <>
          <div className={styles["resize-edge-n"]} onMouseDown={handleResizeStart("n")} />
          <div className={styles["resize-edge-e"]} onMouseDown={handleResizeStart("e")} />
          <div className={styles["resize-edge-s"]} onMouseDown={handleResizeStart("s")} />
          <div className={styles["resize-edge-w"]} onMouseDown={handleResizeStart("w")} />
          <div className={styles["resize-corner-ne"]} onMouseDown={handleResizeStart("ne")} />
          <div className={styles["resize-corner-se"]} onMouseDown={handleResizeStart("se")} />
          <div className={styles["resize-corner-sw"]} onMouseDown={handleResizeStart("sw")} />
          <div className={styles["resize-corner-nw"]} onMouseDown={handleResizeStart("nw")} />
        </>
      )}

      {/* Title bar */}
      <div className={styles["window-titlebar"]} onMouseDown={handleDragStart}>
        <span className={styles["window-titlebar-icon"]}>{declaration.icon}</span>
        <span className={styles["window-titlebar-label"]}>{declaration.label}</span>
        <div className={styles["window-titlebar-actions"]}>
          {minimizable && (
            <button
              type="button"
              className={styles["window-btn"]}
              onClick={() => setMinimized(true)}
              aria-label="Minimize"
            >
              ─
            </button>
          )}
          <button
            type="button"
            className={styles["window-btn"]}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={styles["window-content"]}>
        <SlotRenderer
          slotType="app"
          pluginId={pluginId}
          slotId={slotId}
          session={session}
          toolSetSymbol={toolSetSymbol}
        />
      </div>
    </div>
  );
}
