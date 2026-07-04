import { useRef, useCallback, useEffect, useState, type ReactElement } from 'react';
import styles from './BrowserPanel.module.scss';

// ── Props ──────────────────────────────────────────────────────────────────────

export interface BrowserViewportResizerProps {
  /** Current viewport dimensions. */
  width: number;
  height: number;
  /** Called when the user finishes a drag-resize. */
  onResize(width: number, height: number): void;
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * Draggable resize handles on the bottom and right edges of the live view.
 * Emulates the Chrome DevTools responsive-device-mode resize behaviour.
 *
 * A semi-transparent overlay shows current dimensions during drag.
 * On drag end, `onResize()` is called with the final pixel dimensions.
 */
export function BrowserViewportResizer({
  width,
  height,
  onResize,
}: BrowserViewportResizerProps): ReactElement {
  const [dragging, setDragging] = useState<'right' | 'bottom' | 'corner' | null>(null);
  const [dragSize, setDragSize] = useState({ width, height });
  const startRef = useRef({ x: 0, y: 0, w: width, h: height });

  // Sync dragSize when viewport changes externally.
  useEffect(() => {
    if (!dragging) setDragSize({ width, height });
  }, [width, height, dragging]);

  const handlePointerDown = useCallback((
    edge: 'right' | 'bottom' | 'corner',
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(edge);
    startRef.current = { x: e.clientX, y: e.clientY, w: width, h: height };
  }, [width, height]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    let newW = startRef.current.w;
    let newH = startRef.current.h;

    if (dragging === 'right' || dragging === 'corner') {
      newW = Math.max(320, startRef.current.w + dx);
    }
    if (dragging === 'bottom' || dragging === 'corner') {
      newH = Math.max(180, startRef.current.h + dy);
    }

    setDragSize({ width: Math.round(newW), height: Math.round(newH) });
  }, [dragging]);

  const handlePointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(null);
    onResize(dragSize.width, dragSize.height);
  }, [dragging, dragSize, onResize]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={styles['viewport-resizer']}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDragging(null)}
    >
      {/* Right edge handle */}
      <div
        className={`${styles['vp-handle']} ${styles['vp-handle--right']}${dragging === 'right' || dragging === 'corner' ? ` ${styles['vp-handle--active']}` : ''}`}
        onPointerDown={(e) => handlePointerDown('right', e)}
        title="Drag to resize width"
      />

      {/* Bottom edge handle */}
      <div
        className={`${styles['vp-handle']} ${styles['vp-handle--bottom']}${dragging === 'bottom' || dragging === 'corner' ? ` ${styles['vp-handle--active']}` : ''}`}
        onPointerDown={(e) => handlePointerDown('bottom', e)}
        title="Drag to resize height"
      />

      {/* Corner handle */}
      <div
        className={`${styles['vp-handle']} ${styles['vp-handle--corner']}${dragging ? ` ${styles['vp-handle--active']}` : ''}`}
        onPointerDown={(e) => handlePointerDown('corner', e)}
        title="Drag to resize both"
      />

      {/* Dimension overlay during drag */}
      {dragging && (
        <div className={styles['vp-dim-overlay']}>
          {dragSize.width} × {dragSize.height}
        </div>
      )}
    </div>
  );
}
