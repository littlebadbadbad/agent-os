/**
 * agent-UI/appManager/AppManagerPanel.tsx — Native app manager panel
 *
 * Displays all installed apps with toggle switches for enable/disable
 * and install/uninstall buttons for user-installed apps. Built-in
 * apps cannot be uninstalled.
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
import { appManagerApi } from "./appManagerApi";
import type { AppDescriptor } from "../app/appTypes";
import { useAppSystem } from "../app/AppContext";
import { AppRow } from "./AppRow";
import { InstallDropdown } from "./InstallDropdown";
import { SearchBar } from "./SearchBar";
import { MarketplacePlaceholder } from "./MarketplacePlaceholder";
import styles from "./AppManagerPanel.module.scss";

// ── Props ────────────────────────────────────────────────────────────────────

export interface AppManagerPanelProps {
  readonly onClose: () => void;
}

// ── AppManagerPanel ───────────────────────────────────────────────────────

export function AppManagerPanel({
  onClose: _onClose,
}: AppManagerPanelProps): ReactElement {
  const appSystem = useAppSystem();

  const [apps, setApps] = useState<readonly AppDescriptor[]>([]);
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

  // ── Sync local list with appSystem ────────────────────────────────────

  const syncList = useCallback((): void => {
    setApps(Array.from(appSystem.allApps));
    setError(null);
    setLoading(false);
  }, [appSystem]);

  useEffect(() => {
    syncList();
    return appSystem.subscribe(syncList);
  }, [appSystem, syncList]);

  // ── Toggle handler ────────────────────────────────────────────────────────

  const handleToggle = useCallback(async (app: AppDescriptor) => {
    if (app.canDisable === false) return;
    if (pendingRef.current) return;

    setPending(app.id);
    try {
      if (app.state === "active") {
        await appSystem.disableApp(app.id);
      } else {
        await appSystem.enableApp(app.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, [appSystem]);

  // ── Install handlers ──────────────────────────────────────────────────────

  const handleInstallFromZip = useCallback(async () => {
    setShowInstallMenu(false);
    setOperationMsg("Selecting app ZIP file...");
    const result = await appManagerApi.installFromZip();
    if (result.ok) {
      await appSystem.refreshAppList();
      if (result.appId) {
        await appSystem.activateAppById(result.appId);
      }
    } else {
      setError(result.error ?? "Install failed");
    }
    setOperationMsg(null);
  }, [appSystem]);

  const handleInstallFromFolder = useCallback(async () => {
    setShowInstallMenu(false);
    setOperationMsg("Selecting app folder...");
    const result = await appManagerApi.installFromFolder();
    if (result.ok) {
      await appSystem.refreshAppList();
      if (result.appId) {
        await appSystem.activateAppById(result.appId);
      }
    } else {
      setError(result.error ?? "Install failed");
    }
    setOperationMsg(null);
  }, [appSystem]);

  // ── Uninstall handler ─────────────────────────────────────────────────────

  const handleUninstall = useCallback(async (appId: string) => {
    if (pendingRef.current) return;
    setPending(appId);
    setOperationMsg(null);

    if (appSystem.getActiveApp(appId)) {
      await appSystem.disableApp(appId);
    }

    const result = await appManagerApi.uninstall(appId);
    await appSystem.refreshAppList();
    if (!result.ok) {
      setError(result.error ?? "Uninstall failed");
    }
    setPending(null);
  }, [appSystem]);

  // ── Filtered apps ──────────────────────────────────────────────────────

  const filteredApps = useMemo(() => {
    if (!searchQuery.trim()) return apps;
    const q = searchQuery.toLowerCase();
    return apps.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
    );
  }, [apps, searchQuery]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading apps...</div>
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
            {filteredApps.length}{filteredApps.length !== apps.length ? ` / ${apps.length}` : ""} installed
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
        {filteredApps.map((app) => (
          <AppRow
            key={app.id}
            app={app}
            pending={pendingId === app.id}
            onToggle={handleToggle}
            onUninstall={handleUninstall}
          />
        ))}

        {filteredApps.length === 0 && searchQuery && (
          <div className={styles.empty}>
            No apps match &ldquo;{searchQuery}&rdquo;
          </div>
        )}

        {filteredApps.length === 0 && !searchQuery && (
          <div className={styles.empty}>No apps installed.</div>
        )}
      </div>

      <MarketplacePlaceholder />
    </div>
  );
}

