import type { ReactElement, ReactNode } from 'react';
import type { WidgetIcon, WidgetTheme } from '@agent-sdk';
import { Sidebar } from './Sidebar/Sidebar';

export interface WidgetProps {
  /** Unique identifier used to persist this widget's sidebar state. */
  id?: string;
  /** Initial sidebar width in pixels. Overridden by any stored value. */
  initialWidth?: number;
  /** Custom icon shown in the sidebar header. */
  icon?: WidgetIcon;
  /** Accent color theme overrides. */
  theme?: WidgetTheme;
  /** Optional control bar rendered in the sidebar header. */
  controlBar?: ReactNode;
  children?: ReactNode;
}

/**
 * Root widget wrapper — renders the fixed sidebar that houses the agent UI.
 * State (side, width, open) is persisted per `id` in localStorage.
 */
export function Widget({ id, initialWidth, icon, theme, controlBar, children }: WidgetProps): ReactElement {
  return (
    <Sidebar id={id} icon={icon} theme={theme} initialWidth={initialWidth} controlBar={controlBar}>
      {children}
    </Sidebar>
  );
}

