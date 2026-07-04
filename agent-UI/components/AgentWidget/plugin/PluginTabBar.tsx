/**
 * agent-UI/components/AgentWidget/plugin/PluginTabBar.tsx
 *
 * Generic dynamic plugin tab system.
 *
 * Reads `state.pluginAdapters` (a generic map keyed by plugin id) and
 * renders a tab button for each plugin that has `hasUi === true`.
 *
 * No plugin name is hardcoded — the tab list is fully data-driven.
 * This satisfies R7 (literal zero tolerance for plugin-specific strings
 * in agent-UI).
 */

import type { ReactElement } from "react";
import type { AgentSessionExtension, PluginUiAdapter } from "@agent-type";
import styles from "../AgentWidget.module.scss";
import { pluginSystem } from "@agent-UI/agents";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PluginTabBarProps {
  /** Currently active plugin view (format: `plugin:<id>`), or null. */
  readonly activePluginView: string | null;
  /** Callback when a plugin tab is clicked. */
  readonly onSelect: (view: string) => void;
  readonly pluginStates: Pick<AgentSessionExtension, symbol>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PluginTabBar(props: PluginTabBarProps): ReactElement | null {
  const { activePluginView, onSelect, pluginStates } = props;

  return (
    <>
      {pluginSystem.activePlugins.map(({ id: pluginId, symbols }) => {
        return symbols.map((s) => {
          const view = `plugin:${pluginId}`;
          const hasUi = pluginStates[s]?.showTab?.() ?? false;
          const isActive = activePluginView === view;
          if (!hasUi) return null;
          return (
            <button
              key={s.toString() + pluginId}
              type="button"
              className={`${styles["tab"]}${isActive ? ` ${styles["tab--active"]}` : ""}`}
              onClick={() => onSelect(view)}
            >
              {pluginSystem.getPlugin(pluginId)?.name ?? pluginId}
            </button>
          );
        });
      })}
    </>
  );
}
