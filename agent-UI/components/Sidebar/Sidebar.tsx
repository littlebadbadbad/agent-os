import type { ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_DEFAULT_WIDTH } from '@agent-sdk';

/** Width of the collapsed strip (matches $sidebar-strip-width in _theme.scss). */
const SIDEBAR_STRIP_WIDTH = 32;
import type { WidgetIcon, WidgetTheme } from '@agent-sdk';
import { useSidebarState } from '../../hooks/useSidebarState';
import { SidebarHeader } from './SidebarHeader';
import { AIControlBar } from './AIControlBar';
import styles from './Sidebar.module.scss';

// ── Theme → CSS custom props ──────────────────────────────────────────────────

function themeToAccentVars(theme: WidgetTheme): CSSProperties {
  const vars: Record<string, string> = {};
  const { primaryColor: p, primaryDarkColor: pd, primaryDeepColor: pde, primaryLightColor: pl } = theme;

  if (p) {
    vars['--asdk-primary'] = p;
    const gradientEnd = pd ?? pde ?? p;
    vars['--asdk-gradient'] = `linear-gradient(135deg, ${p} 0%, ${gradientEnd} 100%)`;
  }
  if (pd)  vars['--asdk-primary-dark'] = pd;
  if (pde) vars['--asdk-primary-deep'] = pde;
  if (pl)  vars['--asdk-primary-light'] = pl;

  return vars as CSSProperties;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SidebarProps {
  /** Unique id — used to persist sidebar state per agent in localStorage. */
  id?: string;
  icon?: WidgetIcon;
  theme?: WidgetTheme;
  /** Initial sidebar width (px). Overridden by any stored value. */
  initialWidth?: number;
  children?: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({ id, icon, theme, initialWidth, children }: SidebarProps): ReactElement {
  const defaultWidth = initialWidth ?? SIDEBAR_DEFAULT_WIDTH;
  const { side, width, open, setSide, setWidth, setOpen } = useSidebarState(id, defaultWidth);
  const accentVars = theme ? themeToAccentVars(theme) : undefined;

  // ── Width resize via inner-edge drag ────────────────────────────────────────

  const resizeState = useRef<{ startX: number; startW: number } | null>(null);
  const isDragging = useRef(false);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeState.current = { startX: e.clientX, startW: width };
      isDragging.current = true;

      function onMove(ev: MouseEvent) {
        const rs = resizeState.current;
        if (!rs) return;
        const delta = side === 'right' ? rs.startX - ev.clientX : ev.clientX - rs.startX;
        const maxW = Math.floor(window.innerWidth * 0.8);
        const newW = Math.min(maxW, Math.max(SIDEBAR_MIN_WIDTH, rs.startW + delta));
        setWidth(newW);
      }

      function onUp() {
        resizeState.current = null;
        isDragging.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [side, width, setWidth],
  );

  const handleToggleSide = useCallback(() => {
    setSide(side === 'right' ? 'left' : 'right');
  }, [side, setSide]);

  const handleToggleOpen = useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);

  // ── Push body margin so the sidebar squeezes page content ───────────────────

  useEffect(() => {
    const effectiveWidth = open ? width : SIDEBAR_STRIP_WIDTH;
    const marginProp = side === 'right' ? 'marginRight' : 'marginLeft';
    const resetProp  = side === 'right' ? 'marginLeft'  : 'marginRight';
    const prev = document.body.style[marginProp];
    const prevReset = document.body.style[resetProp];
    document.body.style[marginProp] = `${effectiveWidth}px`;
    document.body.style[resetProp]  = '';
    return () => {
      document.body.style[marginProp] = prev;
      document.body.style[resetProp]  = prevReset;
    };
  }, [side, width, open]);

  // ── Render ───────────────────────────────────────────────────────────────────

  const containerClass = [
    styles['sidebar'],
    styles[`sidebar--${side}`],
    open ? styles['sidebar--open'] : styles['sidebar--closed'],
  ].join(' ');

  const sidebarStyle: CSSProperties = {
    ...accentVars,
    ...(open ? { width, transition: isDragging.current ? 'none' : undefined } : {}),
  };

  return (
    <div className={containerClass} style={sidebarStyle}>
      {/* Resize handle on inner edge (only when expanded) */}
      {open && (
        <div
          className={`${styles['resize-handle']} ${styles[`resize-handle--${side}`]}`}
          onMouseDown={handleResizeMouseDown}
        />
      )}

      {open ? (
        <>
          <SidebarHeader
            icon={icon}
            side={side}
            onToggleSide={handleToggleSide}
            onToggleOpen={handleToggleOpen}
          />
          <div className={styles['content']}>{children}</div>
        </>
      ) : (
        <button
          type="button"
          className={styles['strip-toggle']}
          onClick={handleToggleOpen}
          title="Open agent panel"
          aria-label="Open agent panel"
        >
          <span className={styles['strip-icon']} aria-hidden="true">
            {side === 'right' ? '◀' : '▶'}
          </span>
        </button>
      )}
    </div>
  );
}
