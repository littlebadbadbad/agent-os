/**
 * agent-UI/pluginManager/PluginManagerPanel.tsx — Native plugin manager panel
 *
 * Displays all plugins with toggle switches for enable/disable,
 * install/uninstall buttons, and reinstall support for uninstalled
 * built-in plugins.
 *
 * Uses `pluginManagerApi` directly — no bridge, no iframe, no slot.
 * This is a native React component rendered in the desktop layout.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { pluginManagerApi, type PluginInfo } from "./pluginManagerApi";
import styles from "./PluginManagerPanel.module.scss";

// ── Props ────────────────────────────────────────────────────────────────────

export interface PluginManagerPanelProps {
  readonly onClose: () => void;
}

// ── PluginManagerPanel ───────────────────────────────────────────────────────

export function PluginManagerPanel({
  onClose,
}: PluginManagerPanelProps): ReactElement {
  const [plugins, setPlugins] = useState<readonly PluginInfo[]>([]);
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

  // ── Fetch plugin list ─────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const list = await pluginManagerApi.list();
      setPlugins(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial load + poll for changes ───────────────────────────────────────
  // Since there's no bridge-based onPluginListChanged, we use a simple
  // refresh-after-action pattern instead.  Each mutation calls refresh().

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── Toggle handler ────────────────────────────────────────────────────────

  const handleToggle = useCallback(async (plugin: PluginInfo) => {
    if (plugin.canDisable === false) return;
    if (pendingRef.current) return;

    setPending(plugin.id);
    try {
      if (plugin.state === "active") {
        await pluginManagerApi.disable(plugin.id);
      } else {
        await pluginManagerApi.enable(plugin.id);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, [refresh]);

  // ── Install handlers ──────────────────────────────────────────────────────

  const handleInstallFromZip = useCallback(async () => {
    setShowInstallMenu(false);
    setOperationMsg("Selecting plugin ZIP file...");
    const result = await pluginManagerApi.installFromZip();
    if (result.ok) {
      await refresh();
    } else {
      setError(result.error ?? "Install failed");
    }
    setOperationMsg(null);
  }, [refresh]);

  const handleInstallFromFolder = useCallback(async () => {
    setShowInstallMenu(false);
    setOperationMsg("Selecting plugin folder...");
    const result = await pluginManagerApi.installFromFolder();
    if (result.ok) {
      await refresh();
    } else {
      setError(result.error ?? "Install failed");
    }
    setOperationMsg(null);
  }, [refresh]);

  // ── Uninstall handler ─────────────────────────────────────────────────────

  const handleUninstall = useCallback(async (pluginId: string) => {
    if (pendingRef.current) return;
    setPending(pluginId);
    setOperationMsg(null);
    const result = await pluginManagerApi.uninstall(pluginId);
    if (result.ok) {
      await refresh();
    } else {
      setError(result.error ?? "Uninstall failed");
    }
    setPending(null);
  }, [refresh]);

  // ── Reinstall handler ─────────────────────────────────────────────────────

  const handleReinstall = useCallback(async (pluginId: string) => {
    if (pendingRef.current) return;
    setPending(pluginId);
    setOperationMsg(`Reinstalling ${pluginId}...`);
    const result = await pluginManagerApi.reinstallBuiltIn(pluginId);
    if (result.ok) {
      await refresh();
    } else {
      setError(result.error ?? "Reinstall failed");
    }
    setOperationMsg(null);
    setPending(null);
  }, [refresh]);

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
  readonly plugin: PluginInfo;
  readonly pending: boolean;
  readonly onToggle: (plugin: PluginInfo) => void;
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
  readonly plugin: PluginInfo;
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
