/**
 * extensions/plugin-manager/ui/PluginManagerPanel.tsx — Plugin Manager panel
 *
 * Displays a list of all plugins with toggle switches for enable/disable,
 * install/uninstall buttons, and reinstall support for uninstalled built-in plugins.
 *
 * Subscribes to `host.bridge.onPluginListChanged()` and re-fetches the plugin
 * list via `host.bridge.listPlugins()` on change.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

interface PluginManagerPanelProps {
  host: UiPluginHost;
}

// ── PluginManagerPanel ───────────────────────────────────────────────────────

export function PluginManagerPanel({ host }: PluginManagerPanelProps): React.ReactElement {
  const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showInstallMenu, setShowInstallMenu] = useState(false);
  const [operationMsg, setOperationMsg] = useState<string | null>(null);

  // Use ref to avoid stale closure in async callbacks.
  const pendingRef = useRef<string | null>(null);

  const setPending = (id: string | null): void => {
    pendingRef.current = id;
    setPendingId(id);
  };

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

  // ── Initial load + subscribe ──────────────────────────────────────────────

  useEffect(() => {
    refresh();

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
    if (pendingRef.current) return;

    setPending(plugin.id);
    try {
      if (plugin.state === "active") {
        await host.bridge.disablePlugin?.(plugin.id);
      } else {
        await host.bridge.enablePlugin?.(plugin.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, [host]);

  // ── Install handlers ──────────────────────────────────────────────────────

  const handleInstallFromZip = useCallback(async () => {
    setShowInstallMenu(false);
    setOperationMsg("Select a plugin ZIP file...");
    const result = await host.bridge.installPluginFromZip?.();
    if (result && !result.ok) {
      setError(result.error ?? "Install failed");
    }
    setOperationMsg(null);
  }, [host]);

  const handleInstallFromFolder = useCallback(async () => {
    setShowInstallMenu(false);
    setOperationMsg("Select a plugin folder...");
    const result = await host.bridge.installPluginFromFolder?.();
    if (result && !result.ok) {
      setError(result.error ?? "Install failed");
    }
    setOperationMsg(null);
  }, [host]);

  // ── Uninstall handler ─────────────────────────────────────────────────────

  const handleUninstall = useCallback(async (pluginId: string) => {
    if (pendingRef.current) return;
    setPending(pluginId);
    setOperationMsg(null);
    const result = await host.bridge.uninstallPlugin?.(pluginId);
    if (result && !result.ok) {
      setError(result.error ?? "Uninstall failed");
    }
    setPending(null);
  }, [host]);

  // ── Reinstall handler ─────────────────────────────────────────────────────

  const handleReinstall = useCallback(async (pluginId: string) => {
    if (pendingRef.current) return;
    setPending(pluginId);
    setOperationMsg(`Reinstalling ${pluginId}...`);
    const result = await host.bridge.reinstallBuiltInPlugin?.(pluginId);
    if (result && !result.ok) {
      setError(result.error ?? "Reinstall failed");
    }
    setOperationMsg(null);
    setPending(null);
  }, [host]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading plugins...</div>
      </div>
    );
  }

  const installedPlugins = plugins.filter((p) => p.state !== "not_installed");
  const uninstalledBuiltIns = plugins.filter(
    (p) => p.state === "not_installed" && p.builtIn,
  );

  return (
    <div className={styles.container}>
      {error && (
        <div className={styles.errorBar}>
          <span>{error}</span>
          <button className={styles.dismissBtn} onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {operationMsg && (
        <div className={styles.operationBar}>{operationMsg}</div>
      )}

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Plugin Manager</h1>
          <span className={styles.count}>{installedPlugins.length} installed</span>
        </div>
        <div className={styles.headerActions}>
          {showInstallMenu && (
            <div className={styles.installMenu}>
              <button className={styles.installMenuItem} onClick={handleInstallFromZip}>
                Install from ZIP
              </button>
              <button className={styles.installMenuItem} onClick={handleInstallFromFolder}>
                Install from Folder
              </button>
              <button className={styles.installMenuCancel} onClick={() => setShowInstallMenu(false)}>
                Cancel
              </button>
            </div>
          )}
          <button
            className={styles.installBtn}
            onClick={() => setShowInstallMenu(!showInstallMenu)}
            disabled={!!pendingId}
          >
            + Install
          </button>
        </div>
      </div>

      <div className={styles.list}>
        {installedPlugins.map((plugin) => (
          <PluginRow
            key={plugin.id}
            plugin={plugin}
            pending={pendingId === plugin.id}
            onToggle={handleToggle}
            onUninstall={handleUninstall}
          />
        ))}

        {uninstalledBuiltIns.length > 0 && (
          <>
            <div className={styles.sectionHeader}>
              <span>Uninstalled Built-in Plugins</span>
              <span className={styles.count}>{uninstalledBuiltIns.length}</span>
            </div>
            {uninstalledBuiltIns.map((plugin) => (
              <UninstalledBuiltInRow
                key={plugin.id}
                plugin={plugin}
                onReinstall={handleReinstall}
              />
            ))}
          </>
        )}

        {installedPlugins.length === 0 && uninstalledBuiltIns.length === 0 && (
          <div className={styles.empty}>No plugins found.</div>
        )}
      </div>
    </div>
  );
}

// ── Plugin Row ───────────────────────────────────────────────────────────────

interface PluginRowProps {
  plugin: PluginInfo;
  pending: boolean;
  onToggle: (plugin: PluginInfo) => void;
  onUninstall: (pluginId: string) => void;
}

function PluginRow({ plugin, pending, onToggle, onUninstall }: PluginRowProps): React.ReactElement {
  const isActive = plugin.state === "active";
  const isSelf = plugin.id === "plugin-manager";
  const toggleDisabled = isSelf || plugin.canDisable === false;
  const canUninstall = !isSelf;

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

// ── Uninstalled Built-in Row ─────────────────────────────────────────────────

interface UninstalledBuiltInRowProps {
  plugin: PluginInfo;
  onReinstall: (pluginId: string) => void;
}

function UninstalledBuiltInRow({ plugin, onReinstall }: UninstalledBuiltInRowProps): React.ReactElement {
  return (
    <div className={`${styles.row} ${styles.rowGhost}`}>
      <div className={styles.rowInfo}>
        <div className={styles.rowName}>
          {plugin.name}
          <span className={styles.badge}>built-in</span>
          <span className={styles.badgeGhost}>not installed</span>
        </div>
        <div className={styles.rowDesc}>
          {plugin.description || `Built-in plugin "${plugin.id}"`}
        </div>
        <div className={styles.rowMeta}>
          <span>Not installed</span>
        </div>
      </div>
      <button
        className={styles.reinstallBtn}
        onClick={() => onReinstall(plugin.id)}
      >
        Reinstall
      </button>
    </div>
  );
}
