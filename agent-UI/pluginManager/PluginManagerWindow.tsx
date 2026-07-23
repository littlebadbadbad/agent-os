/**
 * agent-UI/pluginManager/PluginManagerWindow.tsx — Desktop window for Plugin Manager
 *
 * A draggable, resizable window similar to AppWindow but renders the native
 * PluginManagerPanel instead of a slot-based iframe.  Same window chrome
 * (title bar, drag, resize, minimize, close) for visual consistency.
 */

import {
  useCallback,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { PluginManagerPanel } from "./PluginManagerPanel";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;
const TITLE_BAR_HEIGHT = 32;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PluginManagerWindowProps {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly onClose: () => void;
  readonly onFocus: () => void;
  readonly onMinimize: () => void;
  readonly zIndex: number;
  readonly isFocused: boolean;
  readonly isMinimized: boolean;
}

// ── Position state ────────────────────────────────────────────────────────────

interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function centreRect(
  containerRef: RefObject<HTMLDivElement | null>,
): WindowRect {
  const el = containerRef.current;
  const cw = el ? el.clientWidth : window.innerWidth;
  const ch = el ? el.clientHeight : window.innerHeight;
  const w = Math.min(640, cw);
  const h = Math.min(520, ch);
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

export function PluginManagerWindow({
  containerRef,
  onClose,
  onFocus,
  onMinimize,
  zIndex,
  isFocused,
  isMinimized,
}: PluginManagerWindowProps): ReactElement {
  const [rect, setRect] = useState<WindowRect>(() => centreRect(containerRef));
  const [isMaximized, setIsMaximized] = useState(false);
  const savedRectRef = useRef<WindowRect | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // ── Maximize / Restore ───────────────────────────────────────────────────

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      if (savedRectRef.current) {
        setRect(savedRectRef.current);
      }
      setIsMaximized(false);
    } else {
      savedRectRef.current = rect;
      const el = containerRef.current;
      const cw = el ? el.clientWidth : window.innerWidth;
      const ch = el ? el.clientHeight : window.innerHeight;
      setRect({ x: 0, y: 0, width: cw, height: ch });
      setIsMaximized(true);
    }
  }, [isMaximized, rect, containerRef]);

  // ── Drag ─────────────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onFocus();

      const el = containerRef.current;
      const cw = el ? el.clientWidth : window.innerWidth;
      const ch = el ? el.clientHeight : window.innerHeight;
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

  // ── Render ───────────────────────────────────────────────────────────────

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
      className={`plugin-manager-window${isFocused ? " plugin-manager-window--focused" : ""}`}
      style={style}
      onMouseDown={onFocus}
    >
      {/* Title bar */}
      <div
        className="plugin-manager-window__titlebar"
        onMouseDown={handleDragStart}
        onDoubleClick={toggleMaximize}
      >
        <span className="plugin-manager-window__titlebar-icon">🧩</span>
        <span className="plugin-manager-window__titlebar-label">Plugin Manager</span>
        <div className="plugin-manager-window__titlebar-actions">
          <button
            type="button"
            className="plugin-manager-window__titlebar-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            aria-label="Minimize"
          >
            ─
          </button>
          <button
            type="button"
            className="plugin-manager-window__titlebar-btn"
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
            className="plugin-manager-window__titlebar-btn"
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

      {/* Content: native Plugin Manager panel */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <PluginManagerPanel onClose={onClose} />
      </div>
    </div>
  );
}
