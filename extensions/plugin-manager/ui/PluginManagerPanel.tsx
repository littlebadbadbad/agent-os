/**
 * extensions/plugin-manager/ui/PluginManagerPanel.tsx — Main component
 *
 * Displays a list of all plugins with toggle switches to enable/disable.
 * The plugin-manager row is always disabled (cannot disable itself).
 *
 * Reactivity: subscribes to `host.bridge.onPluginListChanged()` and
 * re-fetches the plugin list via `host.bridge.listPlugins()` on change.
 */

import { useCallback, useEffect, useState } from "react";
import type { UiPluginHost } from "@agent-type";
import styles from "./styles.module.scss";

// ── Types ────────────────────────────────────────────────────────────────────

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  state: string;
  builtIn?: boolean;
  canDisable?: boolean;
  hasAgentEntry: boolean;
  hasUiEntry: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

interface PluginManagerPanelProps {
  host: UiPluginHost;
}

export function PluginManagerPanel({ host }: PluginManagerPanelProps): React.ReactElement {
  const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // ── Fetch plugin list ─────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const list = await host.bridge.listPlugins?.();
      if (list) {
        setPlugins(list);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [host]);

  // ── Initial load + subscribe to changes ───────────────────────────────────

  useEffect(() => {
    refresh();

    // Subscribe to plugin list changes from the host.
    const unsub = host.bridge.onPluginListChanged?.(() => {
      refresh();
    });

    return () => {
      unsub?.();
    };
  }, [host, refresh]);

  // ── Toggle handler ────────────────────────────────────────────────────────

  const handleToggle = useCallback(async (plugin: PluginInfo) => {
    if (plugin.id === "plugin-manager" || plugin.canDisable === false) return;
    if (pendingId) return; // Prevent concurrent operations

    setPendingId(plugin.id);
    try {
      if (plugin.state === "active") {
        await host.bridge.disablePlugin?.(plugin.id);
      } else {
        await host.bridge.enablePlugin?.(plugin.id);
      }
      // The host will fire onPluginListChanged → refresh() is called automatically.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }, [host, pendingId]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading plugins...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Plugin Manager</h1>
        <span className={styles.count}>{plugins.length} plugins</span>
      </div>
      <div className={styles.list}>
        {plugins.map((plugin) => (
          <PluginRow
            key={plugin.id}
            plugin={plugin}
            pending={pendingId === plugin.id}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}

// ── Plugin Row ───────────────────────────────────────────────────────────────

interface PluginRowProps {
  plugin: PluginInfo;
  pending: boolean;
  onToggle: (plugin: PluginInfo) => void;
}

function PluginRow({ plugin, pending, onToggle }: PluginRowProps): React.ReactElement {
  const isActive = plugin.state === "active";
  const isSelf = plugin.id === "plugin-manager";
  const isDisabled = isSelf || plugin.canDisable === false;

  return (
    <div className={`${styles.row} ${isActive ? styles.rowActive : ""}`}>
      <div className={styles.rowInfo}>
        <div className={styles.rowName}>
          {plugin.name}
          {plugin.builtIn && <span className={styles.badge}>built-in</span>}
          {isSelf && <span className={styles.badgeSelf}>self</span>}
        </div>
        <div className={styles.rowDesc}>
          {plugin.description || "No description"}
        </div>
        <div className={styles.rowMeta}>
          <span>v{plugin.version}</span>
          <span>·</span>
          <span>{plugin.state}</span>
          {plugin.hasAgentEntry && <span>· agent</span>}
          {plugin.hasUiEntry && <span>· ui</span>}
        </div>
      </div>
      <button
        className={`${styles.toggle} ${isActive ? styles.toggleOn : ""}`}
        disabled={isDisabled || pending}
        onClick={() => onToggle(plugin)}
        title={isDisabled ? "This plugin cannot be disabled" : undefined}
      >
        <span className={styles.toggleKnob} />
      </button>
    </div>
  );
}
