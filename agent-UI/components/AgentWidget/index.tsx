import type { ReactElement } from "react";
import type { WidgetIcon, WidgetTheme, SessionManager } from "@agent-sdk";
import { MultiSessionWidget } from "./session/MultiSessionWidget";

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
  return (
    <MultiSessionWidget
      icon={icon}
      theme={theme}
      initialWidth={initialWidth}
      sessionManager={props.sessionManager}
    />
  );
}

