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
  useEffect,
  useRef,
  useState,
} from "react";
import type { AppSlotDeclaration, SlotDeclaration, SlotSession } from "@agent-type";
import { SlotRenderer } from "../../slots/SlotRenderer";
import { TASKBAR_HEIGHT } from "./Taskbar";
import styles from "./AppWindow.module.scss";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;
const TITLE_BAR_HEIGHT = 32;
/** Pointer must move this far before a mousedown becomes an actual drag/resize — keeps plain clicks (and each half of a double-click) from engaging it. */
const DRAG_THRESHOLD = 4;
/** Dropping a dragged window within this many px of the container's top edge snaps it to maximized (Windows Aero Snap). */
const SNAP_TOP_PX = 4;

/** Cursor shown on the full-viewport overlay while resizing from a given edge. */
const RESIZE_CURSORS: Readonly<Record<string, string>> = {
  n: "n-resize",
  s: "s-resize",
  e: "e-resize",
  w: "w-resize",
  ne: "ne-resize",
  nw: "nw-resize",
  se: "se-resize",
  sw: "sw-resize",
};

/** Active pointer gesture — drives the capture overlay and its cursor. */
type Interaction = { readonly mode: "move" } | { readonly mode: "resize"; readonly edge: string };

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AppWindowProps {
  readonly appId: string;
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
   * built-in desktop apps (App Manager, etc.) that don't go through
   * the app slot / iframe system.
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Resize `origin` by (dx, dy) dragged from `edge`, anchoring the opposite
 * edge in place. Anchoring must happen here (not via a generic post-hoc
 * clamp) so that hitting the min size, or the container boundary, never
 * moves the edge that isn't being dragged.
 */
function resizeRect(
  origin: WindowRect,
  edge: string,
  dx: number,
  dy: number,
  cw: number,
  ch: number,
): WindowRect {
  let { x, y, width, height } = origin;

  if (edge.includes("e")) {
    width = clamp(origin.width + dx, MIN_WIDTH, cw - origin.x);
  }
  if (edge.includes("w")) {
    const right = origin.x + origin.width;
    width = clamp(origin.width - dx, MIN_WIDTH, right);
    x = right - width;
  }
  if (edge.includes("s")) {
    height = clamp(origin.height + dy, MIN_HEIGHT, ch - origin.y);
  }
  if (edge.includes("n")) {
    const bottom = origin.y + origin.height;
    height = clamp(origin.height - dy, MIN_HEIGHT, bottom);
    y = bottom - height;
  }

  return { x, y, width, height };
}

/** Fullscreen bounds: fills the container's current size, stopping above the taskbar. */
function maximizedRect(containerRef: RefObject<HTMLDivElement | null>): WindowRect {
  const { width: cw, height: ch } = getContainerSize(containerRef);
  return { x: 0, y: 0, width: cw, height: Math.max(MIN_HEIGHT, ch - TASKBAR_HEIGHT) };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AppWindow({
  appId,
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
  // Non-null while a drag or resize gesture is in progress — renders the
  // capture overlay that keeps mouse events from being swallowed by the
  // app's iframe content.
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const savedRectRef = useRef<WindowRect | null>(null);

  const resizable = declaration.resizable ?? true;
  const minimizable = declaration.minimizable ?? true;

  // Kept in sync every render so the ResizeObserver callback (set up once)
  // always sees the latest maximized state without re-subscribing.
  const isMaximizedRef = useRef(isMaximized);
  isMaximizedRef.current = isMaximized;

  // While maximized, keep the window filling the container as it changes size
  // (browser resize, or the desktop/sidebar divider being dragged).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (isMaximizedRef.current) {
        setRect(maximizedRect(containerRef));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  // ── Maximize / Restore ───────────────────────────────────────────────────

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      if (savedRectRef.current) {
        setRect(savedRectRef.current);
      }
      setIsMaximized(false);
    } else {
      savedRectRef.current = rect;
      setRect(maximizedRect(containerRef));
      setIsMaximized(true);
    }
  }, [isMaximized, rect, containerRef]);

  const handleTitleBarDoubleClick = useCallback(() => {
    toggleMaximize();
  }, [toggleMaximize]);

  // ── Drag (title bar) ──────────────────────────────────────────────────────
  // Only engages once the pointer clears DRAG_THRESHOLD, so a plain click
  // (including each half of a double-click) never shows the capture overlay
  // or moves the window — matching how Windows distinguishes click vs. drag.
  // If maximized, engaging restores the window and follows the cursor
  // immediately; dropping it near the container's top edge re-maximizes it.

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onFocus();

      const { width: cw, height: ch } = getContainerSize(containerRef);
      const wasMaximized = isMaximized;
      const preDragRect = wasMaximized ? savedRectRef.current : rect;
      const startX = e.clientX;
      const startY = e.clientY;

      let engaged = false;
      let anchorX = startX;
      let anchorY = startY;
      let origin: WindowRect = rect;

      function computeRect(ev: MouseEvent): WindowRect {
        return constrainRect(
          { ...origin, x: origin.x + (ev.clientX - anchorX), y: origin.y + (ev.clientY - anchorY) },
          cw,
          ch,
        );
      }

      function engage(ev: MouseEvent) {
        engaged = true;
        if (wasMaximized && preDragRect) {
          origin = constrainRect(
            {
              ...preDragRect,
              x: ev.clientX - Math.round(preDragRect.width / 2),
              y: Math.max(0, ev.clientY - Math.round(TITLE_BAR_HEIGHT / 2)),
            },
            cw,
            ch,
          );
          setRect(origin);
          setIsMaximized(false);
        } else {
          origin = rect;
        }
        anchorX = ev.clientX;
        anchorY = ev.clientY;
        setInteraction({ mode: "move" });
      }

      function onMove(ev: MouseEvent) {
        if (!engaged) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
          engage(ev);
        }
        setRect(computeRect(ev));
      }

      function endGesture() {
        setInteraction(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("keydown", onKeyDown);
      }

      function onUp(ev: MouseEvent) {
        if (engaged && !wasMaximized) {
          const containerTop = containerRef.current?.getBoundingClientRect().top ?? 0;
          if (ev.clientY - containerTop <= SNAP_TOP_PX) {
            savedRectRef.current = computeRect(ev);
            setRect(maximizedRect(containerRef));
            setIsMaximized(true);
          }
        }
        endGesture();
      }

      function onKeyDown(ev: KeyboardEvent) {
        if (ev.key !== "Escape") return;
        if (engaged) {
          if (wasMaximized) {
            setIsMaximized(true);
            setRect(maximizedRect(containerRef));
          } else {
            setRect(rect);
          }
        }
        endGesture();
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("keydown", onKeyDown);
    },
    [onFocus, rect, containerRef, isMaximized],
  );

  // ── Resize (edges) ────────────────────────────────────────────────────────
  // Same movement threshold as drag, plus Escape reverts to the pre-resize rect.

  const handleResizeStart = useCallback(
    (edge: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus();
      const { width: cw, height: ch } = getContainerSize(containerRef);
      const origin = rect;
      const startX = e.clientX;
      const startY = e.clientY;
      let engaged = false;

      function onMove(ev: MouseEvent) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!engaged) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          engaged = true;
          setInteraction({ mode: "resize", edge });
        }
        setRect(resizeRect(origin, edge, dx, dy, cw, ch));
      }

      function endGesture() {
        setInteraction(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("keydown", onKeyDown);
      }

      function onUp() {
        endGesture();
      }

      function onKeyDown(ev: KeyboardEvent) {
        if (ev.key !== "Escape") return;
        if (engaged) setRect(origin);
        endGesture();
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("keydown", onKeyDown);
    },
    [onFocus, rect, containerRef],
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

      {/* Content — slot app or native component */}
      <div className={styles["content"]}>
        {renderContent
          ? renderContent()
          : (
            <SlotRenderer
              slotType="app"
              appId={appId}
              slotId={slotId}
              session={session}
              toolSetSymbol={toolSetSymbol}
            />
          )}
      </div>

      {/*
        Capture overlay — while dragging/resizing, sits above the app's
        iframe content so mousemove/mouseup keep reaching this document
        instead of being swallowed by the iframe's own browsing context.
      */}
      {interaction && (
        <div
          className={styles["interaction-overlay"]}
          style={{
            cursor: interaction.mode === "move" ? "grabbing" : RESIZE_CURSORS[interaction.edge],
          }}
        />
      )}
    </div>
  );
}
