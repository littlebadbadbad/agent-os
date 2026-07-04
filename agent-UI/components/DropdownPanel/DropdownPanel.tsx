import { useState, useCallback, useEffect, cloneElement, type ReactElement, type ReactNode, type MouseEvent } from 'react';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import styles from './DropdownPanel.module.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A native DOM element (button, div, etc.) or a React component that accepts onClick. */
type TriggerElement = ReactElement<{ onClick?: (e: MouseEvent) => void }>;

/** Render-prop signature for the trigger slot. */
export type TriggerRenderer = (helpers: { open: boolean; toggle: () => void }) => ReactElement;

/** Render-prop signature for the children (panel content) slot. */
export type ChildrenRenderer = (helpers: { close: () => void }) => ReactNode;

export interface DropdownPanelProps {
  /**
   * The trigger element.
   *
   * - Pass a **ReactElement** (e.g. `<button>…</button>`): the component will
   *   inject an `onClick` that toggles the panel.
   * - Pass a **render function** `({ open, toggle }) => …`: use this when the
   *   trigger needs to reflect the panel's open state (e.g. chevron direction).
   */
  trigger: TriggerElement | TriggerRenderer;

  /**
   * The panel content.
   *
   * - Pass a **ReactNode**: rendered as-is when the panel is open.
   * - Pass a **render function** `({ close }) => …`: receives a `close` callback
   *   that can be passed down to inner close buttons.
   */
  children: ReactNode | ChildrenRenderer;

  /** Called whenever the panel closes (outside click OR programmatic `close()`). */
  onClose?: () => void;

  /** Additional class name for the wrapper `<div>`. */
  className?: string;

  /** z-index for the panel. Default: `200`. */
  zIndex?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * A reusable dropdown / popover wrapper that:
 * - Manages `open` / `close` state
 * - Listens for outside clicks to auto-close
 * - Positions the panel using `position: fixed` (not clipped by parent overflow)
 * - Stays attached to the trigger on scroll / resize
 * - Applies consistent panel styling (elevated background, border, shadow)
 *
 * @example
 * ```tsx
 * <DropdownPanel trigger={<button>Open</button>}>
 *   {({ close }) => <PanelContent onClose={close} />}
 * </DropdownPanel>
 * ```
 */
export function DropdownPanel({
  trigger,
  children,
  onClose,
  className,
  zIndex = 200,
}: DropdownPanelProps) {
  const [open, setOpen] = useState(false);

  /** Viewport‑relative panel position {top, right}. */
  const [position, setPosition] = useState({ top: 0, right: 0 });

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  const ref = useOutsideClick<HTMLDivElement>(close);

  // ── Measure trigger position on open (and keep it synced) ────────────────
  useEffect(() => {
    if (!open) return;

    function measure() {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }

    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, ref]);

  const triggerElement =
    typeof trigger === 'function'
      ? trigger({ open, toggle })
      : cloneElement(trigger, {
          onClick: (e: MouseEvent) => {
            trigger.props.onClick?.(e);
            if (!e.defaultPrevented) toggle();
          },
        });

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`} ref={ref}>
      {triggerElement}

      {open && (
        <div
          className={styles.panel}
          style={{ top: position.top, right: position.right, zIndex }}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      )}
    </div>
  );
}
