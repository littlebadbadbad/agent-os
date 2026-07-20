import type { ReactElement } from "react";
import { useEffect } from "react";
import type { WidgetIcon, WidgetTheme, SessionManager } from "@agent-sdk";
import { MultiSessionWidget } from "./session/MultiSessionWidget";
import { AppLauncher } from "../AppLauncher/AppLauncher";
import { PluginProvider } from "../../plugin/PluginContext";
import { injectHostCssVars } from "../../styles/cssVariables";

export type AgentWidgetProps = {
  /** Custom icon shown in the sidebar header. */
  icon?: WidgetIcon;
  /** Accent color theme overrides. */
  theme?: WidgetTheme;
  /** Initial sidebar width in pixels. */
  initialWidth?: number;
} & {
  /**
   * The session manager that owns all sessions.  Enables the session-list
   * header and full multi-session UI.
   */
  sessionManager: SessionManager;
};

export default function AgentWidget(props: AgentWidgetProps): ReactElement {
  const { icon, theme, initialWidth } = props;

  // Inject prefixed CSS vars (--agent-sdk-*) on :root so that sandboxed
  // plugin iframes and external consumers can consume the same design tokens.
  useEffect(() => { injectHostCssVars(); }, []);

  return (
    // Outer PluginProvider (session=null) provides the slot registry to
    // AppLauncher.  MultiSessionWidget has its own inner PluginProvider
    // that shadows this one with the actual panel session for the chat
    // widget subtree.
    <PluginProvider session={null}>
      <AppLauncher />
      <MultiSessionWidget
        icon={icon}
        theme={theme}
        initialWidth={initialWidth}
        sessionManager={props.sessionManager}
      />
    </PluginProvider>
  );
}

