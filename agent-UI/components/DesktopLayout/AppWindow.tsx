/**
 * components/DesktopLayout/AppWindow.tsx — Floating application window
 *
 * A draggable, resizable window constrained to its container (the desktop
 * panel). Uses `position: absolute` + `overflow: hidden` on the container
 * to prevent overlap with the sidebar.
 */

import {
  type ReactElement,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type { AppSlotDeclaration, SlotSession } from "@agent-type";
import { SlotRenderer } from "../../slots/SlotRenderer";
import styles from "./AppWindow.module.scss";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;
const TITLE_BAR_HEIGHT = 32;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AppWindowProps {
  readonly pluginId: string;
  readonly slotId: string;
  readonly declaration: AppSlotDeclaration;
  readonly session: SlotSession | null;
  readonly toolSetSymbol: symbol;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly onClose: () => void;
  readonly onFocus: () => void;
  readonly onMinimize: () => void;
  readonly zIndex: number;
  readonly isFocused: boolean;
  readonly isMinimized: boolean;
  /**
   * Optional native content renderer.
   * When provided, renders this instead of SlotRenderer — used by
   * built-in desktop apps (Plugin Manager, etc.) that don't go through
   * the plugin slot / iframe system.
   */
  readonly renderContent?: () => ReactElement;
}

// ── Position state ────────────────────────────────────────────────────────────

interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getContainerSize(
  containerRef: RefObject<HTMLDivElement | null>,
): { width: number; height: number } {
  const el = containerRef.current;
  if (el) {
    return { width: el.clientWidth, height: el.clientHeight };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

function centreRect(
  declaration: AppSlotDeclaration,
  containerRef: RefObject<HTMLDivElement | null>,
): WindowRect {
  const { width: cw, height: ch } = getContainerSize(containerRef);
  const w = Math.min(declaration.defaultWidth ?? 600, cw);
  const h = Math.min(declaration.defaultHeight ?? 400, ch);
  return {
    x: Math.max(0, Math.round((cw - w) / 2)),
    y: Math.max(0, Math.round((ch - h) / 3)),
    width: w,
    height: h,
  };
}

function constrainRect(
  rect: WindowRect,
  cw: number,
  ch: number,
): WindowRect {
  const w = Math.max(MIN_WIDTH, Math.min(rect.width, cw));
  const h = Math.max(MIN_HEIGHT, Math.min(rect.height, ch));
  return {
    x: Math.max(0, Math.min(rect.x, cw - w)),
    y: Math.max(0, Math.min(rect.y, ch - h)),
    width: w,
    height: h,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AppWindow({
  pluginId,
  slotId,
  declaration,
  session,
  toolSetSymbol,
  containerRef,
  onClose,
  onFocus,
  onMinimize,
  zIndex,
  isFocused,
  isMinimized,
  renderContent,
}: AppWindowProps): ReactElement {
  const [rect, setRect] = useState<WindowRect>(() => centreRect(declaration, containerRef));
  const [isMaximized, setIsMaximized] = useState(false);
  const savedRectRef = useRef<WindowRect | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    origW: number;
    origH: number;
    edge: string;
  } | null>(null);

  const resizable = declaration.resizable ?? true;
  const minimizable = declaration.minimizable ?? true;

  // ── Maximize / Restore ───────────────────────────────────────────────────

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      if (savedRectRef.current) {
        setRect(savedRectRef.current);
      }
      setIsMaximized(false);
    } else {
      savedRectRef.current = rect;
      const { width: cw, height: ch } = getContainerSize(containerRef);
      setRect({ x: 0, y: 0, width: cw, height: ch });
      setIsMaximized(true);
    }
  }, [isMaximized, rect, containerRef]);

  const handleTitleBarDoubleClick = useCallback(() => {
    toggleMaximize();
  }, [toggleMaximize]);

  // ── Drag (title bar) — clamped to container ──────────────────────────────
  // If maximized, restores first and follows cursor immediately (Windows-style).

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onFocus();

      const { width: cw, height: ch } = getContainerSize(containerRef);
      let startRect: WindowRect;

      if (isMaximized) {
        const saved = savedRectRef.current;
        if (!saved) return;
        startRect = constrainRect(
          {
            ...saved,
            x: e.clientX - Math.round(saved.width / 2),
            y: Math.max(0, e.clientY - Math.round(TITLE_BAR_HEIGHT / 2)),
          },
          cw,
          ch,
        );
        setRect(startRect);
        setIsMaximized(false);
      } else {
        startRect = rect;
      }

      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: startRect.x,
        origY: startRect.y,
      };

      function onMove(ev: MouseEvent) {
        const d = dragRef.current;
        if (!d) return;
        setRect((prev) =>
          constrainRect(
            {
              ...prev,
              x: d.origX + (ev.clientX - d.startX),
              y: d.origY + (ev.clientY - d.startY),
            },
            cw,
            ch,
          ),
        );
      }

      function onUp() {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onFocus, rect, containerRef, isMaximized],
  );

  // ── Resize (edges) — clamped to container ────────────────────────────────

  const handleResizeStart = useCallback(
    (edge: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { width: cw, height: ch } = getContainerSize(containerRef);
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: rect.width,
        origH: rect.height,
        edge,
      };

      function onMove(ev: MouseEvent) {
        const r = resizeRef.current;
        if (!r) return;
        const dx = ev.clientX - r.startX;
        const dy = ev.clientY - r.startY;
        setRect((prev) => {
          let { x, y, width, height } = prev;
          if (r.edge.includes("e")) width = r.origW + dx;
          if (r.edge.includes("w")) {
            width = r.origW - dx;
            x = r.startX + r.origW - width;
          }
          if (r.edge.includes("s")) height = r.origH + dy;
          if (r.edge.includes("n")) {
            height = r.origH - dy;
            y = r.startY + r.origH - height;
          }
          return constrainRect({ x, y, width, height }, cw, ch);
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
    [rect.width, rect.height, containerRef],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  const windowClass = [
    styles["window"],
    isFocused ? styles["window--focused"] : "",
    isMaximized ? styles["window--maximized"] : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style: Record<string, string | number | undefined> = {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    zIndex,
    display: isMinimized ? "none" : undefined,
  };

  return (
    <div
      className={windowClass}
      style={style}
      onMouseDown={onFocus}
    >
      {/* Resize edges — hidden when maximised */}
      {resizable && !isMaximized && (
        <>
          <div className={styles["resize-n"]} onMouseDown={handleResizeStart("n")} />
          <div className={styles["resize-e"]} onMouseDown={handleResizeStart("e")} />
          <div className={styles["resize-s"]} onMouseDown={handleResizeStart("s")} />
          <div className={styles["resize-w"]} onMouseDown={handleResizeStart("w")} />
          <div className={styles["resize-ne"]} onMouseDown={handleResizeStart("ne")} />
          <div className={styles["resize-se"]} onMouseDown={handleResizeStart("se")} />
          <div className={styles["resize-sw"]} onMouseDown={handleResizeStart("sw")} />
          <div className={styles["resize-nw"]} onMouseDown={handleResizeStart("nw")} />
        </>
      )}

      {/* Title bar — double-click toggles maximise */}
      <div
        className={styles["titlebar"]}
        onMouseDown={handleDragStart}
        onDoubleClick={handleTitleBarDoubleClick}
      >
        <span className={styles["titlebar-icon"]}>{declaration.icon}</span>
        <span className={styles["titlebar-label"]}>{declaration.label}</span>
        <div className={styles["titlebar-actions"]}>
          {minimizable && (
            <button
              type="button"
              className={styles["titlebar-btn"]}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onMinimize();
              }}
              aria-label="Minimize"
            >
              ─
            </button>
          )}
          <button
            type="button"
            className={styles["titlebar-btn"]}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleMaximize();
            }}
            aria-label={isMaximized ? "Restore" : "Maximise"}
          >
            {isMaximized ? "❐" : "□"}
          </button>
          <button
            type="button"
            className={styles["titlebar-btn"]}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content — slot plugin or native component */}
      <div className={styles["content"]}>
        {renderContent
          ? renderContent()
          : (
            <SlotRenderer
              slotType="app"
              pluginId={pluginId}
              slotId={slotId}
              session={session}
              toolSetSymbol={toolSetSymbol}
            />
          )}
      </div>
    </div>
  );
}
