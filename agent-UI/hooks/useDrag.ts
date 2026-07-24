import { useCallback, useRef } from 'react';
import type { PointerEventHandler } from 'react';
import { DRAG_THRESHOLD } from '../constants';
import type { Position } from '@agent-type';

export interface DragHandlers {
  onDrag: (pos: Position) => void;
  onClick?: () => void;
  /** Called once on pointer-up after a drag, with the final dragged position. */
  onDragEnd?: (pos: Position) => void;
}

interface PointerState {
  startPointerX: number;
  startPointerY: number;
  startElemX: number;
  startElemY: number;
  hasMoved: boolean;
  lastX: number;
  lastY: number;
}

/**
 * Unified drag + click hook backed by pointer events.
 *
 * - Movement < DRAG_THRESHOLD pixels → treated as a click (calls `onClick`).
 * - Movement ≥ DRAG_THRESHOLD pixels → treated as a drag (calls `onDrag` on
 *   every pointermove with the new absolute element position).
 *
 * The returned `onPointerDown` handler is stable (no deps array resets).
 * Always-fresh `handlers` and `currentPos` are accessed via refs so the
 * closure never goes stale.
 */
export function useDrag(
  currentPos: Position,
  handlers: DragHandlers,
): { onPointerDown: PointerEventHandler<HTMLDivElement> } {
  const handlersRef = useRef<DragHandlers>(handlers);
  handlersRef.current = handlers;

  const currentPosRef = useRef<Position>(currentPos);
  currentPosRef.current = currentPos;

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    if (e.button !== 0) return; // only left-button

    const state: PointerState = {
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startElemX: currentPosRef.current.x,
      startElemY: currentPosRef.current.y,
      hasMoved: false,
      lastX: currentPosRef.current.x,
      lastY: currentPosRef.current.y,
    };

    const handleMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - state.startPointerX;
      const dy = ev.clientY - state.startPointerY;
      if (!state.hasMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      state.hasMoved = true;
      state.lastX = state.startElemX + dx;
      state.lastY = state.startElemY + dy;
      handlersRef.current.onDrag({ x: state.lastX, y: state.lastY });
    };

    const handleUp = (): void => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      if (!state.hasMoved) {
        handlersRef.current.onClick?.();
      } else {
        handlersRef.current.onDragEnd?.({ x: state.lastX, y: state.lastY });
      }
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, []); // intentionally empty — relies entirely on refs

  return { onPointerDown };
}
