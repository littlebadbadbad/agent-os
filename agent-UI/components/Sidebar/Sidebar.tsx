import type { ReactElement, ReactNode } from 'react';
import { useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { WidgetIcon, WidgetTheme } from '@agent-type';
import { SidebarHeader } from './SidebarHeader';
import styles from './Sidebar.module.scss';

// ── Theme → CSS custom props ──────────────────────────────────────────────────

function themeToAccentVars(theme: WidgetTheme): CSSProperties {
  const vars: Record<string, string> = {};
  const { primaryColor: p, primaryDarkColor: pd, primaryDeepColor: pde, primaryLightColor: pl } = theme;

  if (p) {
    vars['--primary'] = p;
    const gradientEnd = pd ?? pde ?? p;
    vars['--gradient-primary'] = `linear-gradient(135deg, ${p} 0%, ${gradientEnd} 100%)`;
  }
  if (pd)  vars['--primary-dark'] = pd;
  if (pde) vars['--primary-deep'] = pde;
  if (pl)  vars['--primary-light'] = pl;

  return vars as CSSProperties;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SidebarProps {
  /** Unique id — used to persist sidebar state per agent in localStorage. */
  id?: string;
  icon?: WidgetIcon;
  theme?: WidgetTheme;
  /** Optional control bar rendered in the sidebar header. */
  controlBar?: ReactNode;
  children?: ReactNode;
  /** Whether the sidebar is open. */
  readonly open: boolean;
  /** Called when the sidebar toggles between open and closed. */
  readonly onToggleOpen: (open: boolean) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({ open, onToggleOpen, icon, theme, controlBar, children }: SidebarProps): ReactElement {
  const accentVars = theme ? themeToAccentVars(theme) : undefined;

  const handleToggleOpen = useCallback(() => {
    onToggleOpen(!open);
  }, [open, onToggleOpen]);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (open) {
    return (
      <div className={`${styles['sidebar']} ${styles['sidebar--open']}`} style={accentVars}>
        <SidebarHeader
          icon={icon}
          onToggleOpen={handleToggleOpen}
          controlBar={controlBar}
        />
        <div className={styles['content']}>{children}</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${styles['sidebar']} ${styles['sidebar--closed']}`}
      onClick={handleToggleOpen}
      title="Open agent panel"
      aria-label="Open agent panel"
    >
      <span className={styles['strip-icon']} aria-hidden="true">◀</span>
    </button>
  );
}
