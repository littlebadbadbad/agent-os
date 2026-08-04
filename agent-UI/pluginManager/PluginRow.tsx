/**
 * agent-UI/pluginManager/PluginRow.tsx — Single plugin row in the manager list
 */

import { type ReactElement } from "react";
import type { PluginDescriptor } from "../plugin/pluginTypes";
import styles from "./PluginManagerPanel.module.scss";

interface PluginRowProps {
  readonly plugin: PluginDescriptor;
  readonly pending: boolean;
  readonly onToggle: (plugin: PluginDescriptor) => void;
  readonly onUninstall: (pluginId: string) => void;
}

export function PluginRow({
  plugin,
  pending,
  onToggle,
  onUninstall,
}: PluginRowProps): ReactElement {
  const isActive = plugin.state === "active";
  const toggleDisabled = plugin.canDisable === false;
  const canUninstall = !plugin.builtIn;

  return (
    <div className={`${styles.row} ${isActive ? styles.rowActive : ""}`}>
      <div className={styles.rowInfo}>
        <div className={styles.rowName}>
          {plugin.name}
          {plugin.builtIn && <span className={styles.badge}>built-in</span>}
        </div>
        <div className={styles.rowDesc}>
          {plugin.description || "No description"}
        </div>
        <div className={styles.rowMeta}>
          <span>v{plugin.version}</span>
          <span className={styles.sep}>·</span>
          <span className={plugin.state === "error" ? styles.stateError : ""}>
            {plugin.state}
          </span>
          {plugin.hasAgentEntry && <><span className={styles.sep}>·</span><span>agent</span></>}
          {plugin.hasUiEntry && <><span className={styles.sep}>·</span><span>ui</span></>}
        </div>
      </div>
      <div className={styles.rowActions}>
        {canUninstall && (
          <button
            className={styles.uninstallBtn}
            disabled={pending}
            onClick={() => onUninstall(plugin.id)}
            title="Uninstall this plugin"
          >
            Uninstall
          </button>
        )}
        <button
          className={`${styles.toggle} ${isActive ? styles.toggleOn : ""}`}
          disabled={toggleDisabled || pending}
          onClick={() => onToggle(plugin)}
          title={toggleDisabled ? "This plugin cannot be disabled" : undefined}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>
    </div>
  );
}
