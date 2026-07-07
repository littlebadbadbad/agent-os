/**
 * agent-UI/components/AgentWidget/plugin/PluginTabBar.tsx
 *
 * Pure slot-driven plugin tab system.
 *
 * Reads {@link PanelSlotDeclaration} entries from {@link SlotRegistry},
 * sorts by `order`, and renders a tab for each visible panel.
 *
 * No plugin name is hardcoded — fully data-driven.
 */

import { type ReactElement } from "react";
import type { PanelSlotDeclaration } from "@agent-type";
import styles from "../AgentWidget.module.scss";
import { slotRegistry, type SlotEntry } from "../../../slots/registry";

export interface PluginTabBarProps {
  readonly activePluginView: string | null;
  readonly onSelect: (view: string) => void;
}

export function PluginTabBar(props: PluginTabBarProps): ReactElement | null {
  const { activePluginView, onSelect } = props;

  const panelSlots: ReadonlyArray<SlotEntry<PanelSlotDeclaration>> =
    slotRegistry.getByType("panel");

  if (panelSlots.length === 0) return null;

  return (
    <>
      {panelSlots
        .slice()
        .sort((a, b) => (a.declaration.order ?? 100) - (b.declaration.order ?? 100))
        .map((entry) => {
          const { pluginId, declaration } = entry;
          const view = `plugin:${pluginId}`;
          const show = declaration.showTab();
          const isActive = activePluginView === view;
          if (!show) return null;
          const badgeText = declaration.badge?.() ?? null;
          return (
            <button
              key={`${pluginId}:${declaration.id}`}
              type="button"
              className={`${styles["tab"]}${isActive ? ` ${styles["tab--active"]}` : ""}`}
              onClick={() => onSelect(view)}
            >
              {declaration.icon && <span>{declaration.icon} </span>}
              {declaration.label}
              {badgeText !== null && (
                <span className={styles["tab-badge"]}>{badgeText}</span>
              )}
            </button>
          );
        })}
    </>
  );
}
