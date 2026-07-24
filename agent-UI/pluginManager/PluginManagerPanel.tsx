/**
 * agent-UI/pluginManager/PluginManagerPanel.tsx — Native plugin manager panel
 *
 * Displays all plugins with toggle switches for enable/disable,
 * install/uninstall buttons, and reinstall support for uninstalled
 * built-in plugins.
 *
 * Uses `pluginSystem` for lifecycle-aware enable/disable — subscribers
 * (slot registry, tool registry) are notified so tools and panels
 * disappear when a plugin is disabled.
 *
 * Install/uninstall/reinstall delegate to `pluginManagerApi` and then
 * synchronise via `pluginSystem.refreshPluginList()`.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { pluginManagerApi } from "./pluginManagerApi";
import type { PluginDescriptor } from "../plugin/pluginTypes";
import { usePluginSystem } from "../plugin/PluginContext";
import styles from "./PluginManagerPanel.module.scss";

// ── Props ────────────────────────────────────────────────────────────────────

export interface PluginManagerPanelProps {
  readonly onClose: () => void;
}

// ── PluginManagerPanel ───────────────────────────────────────────────────────

export function PluginManagerPanel({
  onClose,
}: PluginManagerPanelProps): ReactElement {
  const pluginSystem = usePluginSystem();

  const [plugins, setPlugins] = useState<readonly PluginDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showInstallMenu, setShowInstallMenu] = useState(false);
  const [operationMsg, setOperationMsg] = useState<string | null>(null);

  const pendingRef = useRef<string | null>(null);

  const setPending = (id: string | null): void => {
    pendingRef.current = id;
    setPendingId(id);
  };

  // ── Sync local list with pluginSystem ────────────────────────────────────

  const syncList = useCallback((): void => {
    setPlugins(Array.from(pluginSystem.allPlugins));
    setError(null);
    setLoading(false);
  }, [pluginSystem]);

  // Subscribe to pluginSystem changes — triggers on enable/disable/refresh.
  useEffect(() => {
    syncList();
    return pluginSystem.subscribe(syncList);
  }, [pluginSystem, syncList]);

  // ── Toggle handler ────────────────────────────────────────────────────────
  // Goes through pluginSystem for proper lifecycle management:
  //   disable  → unregisters tools + removes slots + notifies subscribers
  //   enable   → activates agent entry + notifies subscribers

  const handleToggle = useCallback(async (plugin: PluginDescriptor) => {
    if (plugin.canDisable === false) return;
    if (pendingRef.current) return;

    setPending(plugin.id);
    try {
      if (plugin.state === "active") {
        await pluginSystem.disablePlugin(plugin.id);
      } else {
        await pluginSystem.enablePlugin(plugin.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, [pluginSystem]);

  // ── Install handlers ──────────────────────────────────────────────────────

  const handleInstallFromZip = useCallback(async () => {
    setShowInstallMenu(false);
    setOperationMsg("Selecting plugin ZIP file...");
    const result = await pluginManagerApi.installFromZip();
    if (result.ok) {
      await pluginSystem.refreshPluginList();
    } else {
      setError(result.error ?? "Install failed");
    }
    setOperationMsg(null);
  }, [pluginSystem]);

  const handleInstallFromFolder = useCallback(async () => {
    setShowInstallMenu(false);
    setOperationMsg("Selecting plugin folder...");
    const result = await pluginManagerApi.installFromFolder();
    if (result.ok) {
      await pluginSystem.refreshPluginList();
    } else {
      setError(result.error ?? "Install failed");
    }
    setOperationMsg(null);
  }, [pluginSystem]);

  // ── Uninstall handler ─────────────────────────────────────────────────────
  // Deactivate first if the plugin is active, then uninstall from backend.

  const handleUninstall = useCallback(async (pluginId: string) => {
    if (pendingRef.current) return;
    setPending(pluginId);
    setOperationMsg(null);

    if (pluginSystem.getActivePlugin(pluginId)) {
      await pluginSystem.disablePlugin(pluginId);
    }

    const result = await pluginManagerApi.uninstall(pluginId);
    if (result.ok) {
      await pluginSystem.refreshPluginList();
    } else {
      setError(result.error ?? "Uninstall failed");
    }
    setPending(null);
  }, [pluginSystem]);

  // ── Reinstall handler ─────────────────────────────────────────────────────

  const handleReinstall = useCallback(async (pluginId: string) => {
    if (pendingRef.current) return;
    setPending(pluginId);
    setOperationMsg(`Reinstalling ${pluginId}...`);

    if (pluginSystem.getActivePlugin(pluginId)) {
      await pluginSystem.disablePlugin(pluginId);
    }

    const result = await pluginManagerApi.reinstallBuiltIn(pluginId);
    if (result.ok) {
      await pluginSystem.refreshPluginList();
    } else {
      setError(result.error ?? "Reinstall failed");
    }
    setOperationMsg(null);
    setPending(null);
  }, [pluginSystem]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.titleBar}>
          <h1 className={styles.title}>Plugin Manager</h1>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
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
      <div className={styles.titleBar}>
        <h1 className={styles.title}>Plugin Manager</h1>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

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
  readonly plugin: PluginDescriptor;
  readonly pending: boolean;
  readonly onToggle: (plugin: PluginDescriptor) => void;
  readonly onUninstall: (pluginId: string) => void;
}

function PluginRow({
  plugin,
  pending,
  onToggle,
  onUninstall,
}: PluginRowProps): ReactElement {
  const isActive = plugin.state === "active";
  const toggleDisabled = plugin.canDisable === false;
  const canUninstall = true;

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

// ── Uninstalled Built-in Row ─────────────────────────────────────────────────

interface UninstalledBuiltInRowProps {
  readonly plugin: PluginDescriptor;
  readonly onReinstall: (pluginId: string) => void;
}

function UninstalledBuiltInRow({
  plugin,
  onReinstall,
}: UninstalledBuiltInRowProps): ReactElement {
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
