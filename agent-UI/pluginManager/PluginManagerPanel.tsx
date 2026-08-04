/**
 * agent-UI/pluginManager/PluginManagerPanel.tsx — Native plugin manager panel
 *
 * Displays all installed plugins with toggle switches for enable/disable
 * and install/uninstall buttons for user-installed plugins. Built-in
 * plugins cannot be uninstalled.
 *
 * The parent window already provides chrome (title bar, close button) —
 * this component renders only the body content.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { pluginManagerApi } from "./pluginManagerApi";
import type { PluginDescriptor } from "../plugin/pluginTypes";
import { usePluginSystem } from "../plugin/PluginContext";
import { PluginRow } from "./PluginRow";
import { InstallDropdown } from "./InstallDropdown";
import { SearchBar } from "./SearchBar";
import { MarketplacePlaceholder } from "./MarketplacePlaceholder";
import styles from "./PluginManagerPanel.module.scss";

// ── Props ────────────────────────────────────────────────────────────────────

export interface PluginManagerPanelProps {
  readonly onClose: () => void;
}

// ── PluginManagerPanel ───────────────────────────────────────────────────────

export function PluginManagerPanel({
  onClose: _onClose,
}: PluginManagerPanelProps): ReactElement {
  const pluginSystem = usePluginSystem();

  const [plugins, setPlugins] = useState<readonly PluginDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showInstallMenu, setShowInstallMenu] = useState(false);
  const [operationMsg, setOperationMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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

  useEffect(() => {
    syncList();
    return pluginSystem.subscribe(syncList);
  }, [pluginSystem, syncList]);

  // ── Toggle handler ────────────────────────────────────────────────────────

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
      if (result.pluginId) {
        await pluginSystem.activatePluginById(result.pluginId);
      }
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
      if (result.pluginId) {
        await pluginSystem.activatePluginById(result.pluginId);
      }
    } else {
      setError(result.error ?? "Install failed");
    }
    setOperationMsg(null);
  }, [pluginSystem]);

  // ── Uninstall handler ─────────────────────────────────────────────────────

  const handleUninstall = useCallback(async (pluginId: string) => {
    if (pendingRef.current) return;
    setPending(pluginId);
    setOperationMsg(null);

    if (pluginSystem.getActivePlugin(pluginId)) {
      await pluginSystem.disablePlugin(pluginId);
    }

    const result = await pluginManagerApi.uninstall(pluginId);
    await pluginSystem.refreshPluginList();
    if (!result.ok) {
      setError(result.error ?? "Uninstall failed");
    }
    setPending(null);
  }, [pluginSystem]);

  // ── Filtered plugins ──────────────────────────────────────────────────────

  const filteredPlugins = useMemo(() => {
    if (!searchQuery.trim()) return plugins;
    const q = searchQuery.toLowerCase();
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
    );
  }, [plugins, searchQuery]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading plugins...</div>
      </div>
    );
  }

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

      <div className={styles.toolbar}>
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
        <div className={styles.toolbarActions}>
          <span className={styles.count}>
            {filteredPlugins.length}{filteredPlugins.length !== plugins.length ? ` / ${plugins.length}` : ""} installed
          </span>
          <div className={styles.installBtnWrapper}>
            {showInstallMenu && (
              <InstallDropdown
                onInstallFromZip={handleInstallFromZip}
                onInstallFromFolder={handleInstallFromFolder}
                onClose={() => setShowInstallMenu(false)}
              />
            )}
            <button
              className={styles.installBtn}
              disabled={!!pendingId}
              onClick={() => setShowInstallMenu(!showInstallMenu)}
            >
              + Install
            </button>
          </div>
        </div>
      </div>

      <div className={styles.list}>
        {filteredPlugins.map((plugin) => (
          <PluginRow
            key={plugin.id}
            plugin={plugin}
            pending={pendingId === plugin.id}
            onToggle={handleToggle}
            onUninstall={handleUninstall}
          />
        ))}

        {filteredPlugins.length === 0 && searchQuery && (
          <div className={styles.empty}>
            No plugins match &ldquo;{searchQuery}&rdquo;
          </div>
        )}

        {filteredPlugins.length === 0 && !searchQuery && (
          <div className={styles.empty}>No plugins installed.</div>
        )}
      </div>

      <MarketplacePlaceholder />
    </div>
  );
}

