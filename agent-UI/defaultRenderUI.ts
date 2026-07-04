import type { WidgetIcon, WidgetTheme, SessionManager } from '@agent-sdk';
import { renderWidget } from './render';
import { SidebarSide } from './hooks/useSidebarState';

export type DefaultRenderUIConfig = {
  /** Custom icon shown in the sidebar header. Pass an emoji string or a DOM/SVG element. */
  icon?: WidgetIcon;
  /** Accent color theme overrides. Only accent tokens are applied; dark base palette is fixed. */
  theme?: WidgetTheme;
  /** Initial sidebar width in pixels. Default: 360. Overridden by stored user preference. */
  initialWidth?: number;
  /**
   * Initial side for the sidebar.
   * @deprecated The user's stored preference takes precedence once set.
   */
  sidebarSide?: SidebarSide;
  /**
   * @deprecated panelSize is no longer used. Pass `initialWidth` instead.
   * `panelSize.width` is mapped to `initialWidth` for backward compatibility.
   */
  panelSize?: { width: number; height: number };
};

/**
 * Creates the default React-based UI renderer for `createAgentClient`.
 *
 * Renders a fixed sidebar that docks to the right edge of the page by default.
 * The user can collapse it, switch it to the left edge, and drag its width.
 *
 * @example
 * ```ts
 * const renderUI = createDefaultUIRenderer({ icon: '🤖', theme: { primaryColor: '#0078d4' } });
 * const agent = createAgentClient({ handler, renderUI });
 * ```
 */
export function createDefaultUIRenderer(
  uiConfig: DefaultRenderUIConfig = {},
): (sessionManager: SessionManager, container: HTMLElement) => () => void {
  const initialWidth = uiConfig.initialWidth ?? uiConfig.panelSize?.width;
  return (sessionManager, container) => {
    return renderWidget(container, {
      icon: uiConfig.icon,
      theme: uiConfig.theme,
      initialWidth,
      sessionManager,
    });
  };
}

