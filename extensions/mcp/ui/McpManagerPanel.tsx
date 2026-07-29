/**
 * extensions/mcp/ui/McpManagerPanel.tsx — dropdown panel for managing MCP servers.
 *
 * Self-contained component: manages its own server list state by calling
 * agent-side methods via `host.bridge`. No dependency on ToolSet state
 * or direct backend calls.
 *
 * Capabilities:
 *  • List all servers with status indicator + tool count
 *  • Connect / disconnect / reload individual servers
 *  • Delete a server (with inline confirmation)
 *  • Add a new server (inline form: name, url, transport, optional headers)
 */

import { useState, useEffect, useCallback } from "react";
import type { UiPluginHost, PluginStateExtension } from "@agent-type";
import type {
  McpTransport,
  McpServerStatus,
  McpServerEntry,
  McpBridge,
} from "../agent/types";

const MCP_TRANSPORTS: McpTransport[] = ["http", "sse"];
import styles from "./styles.module.scss";

// ── Props ────────────────────────────────────────────────────────────────────

export interface McpManagerPanelProps {
  /** The UiPluginHost with a pre-bound apiClient for this plugin. */
  readonly host: UiPluginHost<PluginStateExtension, McpBridge>;
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: McpServerStatus }) {
  const cls = {
    connected: styles.dotConnected,
    connecting: styles.dotConnecting,
    error: styles.dotError,
    disconnected: styles.dotDisconnected,
  }[status];
  return <span className={`${styles.dot} ${cls}`} />;
}

// ── Add-server form ───────────────────────────────────────────────────────────

interface AddFormProps {
  onAdded: () => void;
  onCancel: () => void;
  host: UiPluginHost<PluginStateExtension, McpBridge>;
}

function AddServerForm({ onAdded, onCancel, host }: AddFormProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<McpTransport>("http");
  const [headersRaw, setHeadersRaw] = useState("");
  const [useProxy, setUseProxy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      let headers: Record<string, string> | undefined;
      if (headersRaw.trim()) {
        try {
          headers = JSON.parse(headersRaw);
        } catch {
          throw new Error(
            'Headers must be valid JSON, e.g. {"Authorization":"Bearer xxx"}',
          );
        }
      }
      await host.bridge.addServer({
        name: name.trim(),
        url: url.trim(),
        transport,
        headers,
        useProxy,
      });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <div className={styles.addTitle}>Add MCP Server</div>

      <label className={styles.addLabel}>Name *</label>
      <input
        className={styles.addInput}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="github"
        required
        disabled={saving}
        autoFocus
      />

      <label className={styles.addLabel}>URL *</label>
      <input
        className={styles.addInput}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://mcp.example.com/mcp"
        required
        disabled={saving}
        type="url"
      />

      <label className={styles.addLabel}>Transport</label>
      <div className={styles.transportRow}>
        {MCP_TRANSPORTS.map((t) => (
          <button
            key={t}
            type="button"
            className={`${styles.transportBtn} ${transport === t ? styles.transportBtnActive : ""}`}
            onClick={() => setTransport(t)}
            disabled={saving}
          >
            {t === "http" ? "HTTP (recommended)" : "SSE (legacy)"}
          </button>
        ))}
      </div>

      <label className={styles.proxyToggle}>
        <input
          type="checkbox"
          checked={useProxy}
          onChange={(e) => setUseProxy(e.target.checked)}
          disabled={saving}
        />
        Use proxy (enable to route through system proxy)
      </label>

      <label className={styles.addLabel}>Headers (optional JSON)</label>
      <input
        className={styles.addInput}
        value={headersRaw}
        onChange={(e) => setHeadersRaw(e.target.value)}
        placeholder='{"Authorization":"Bearer <token>"}'
        disabled={saving}
      />

      {error && <div className={styles.addError}>{error}</div>}

      <div className={styles.addActions}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={saving || !name.trim() || !url.trim()}
        >
          {saving ? "Connecting\u2026" : "Connect"}
        </button>
      </div>
    </form>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

async function fetchFromAgent(host: UiPluginHost<PluginStateExtension, McpBridge>): Promise<McpServerEntry[]> {
  try {
    return await host.bridge.sync();
  } catch {
    return [];
  }
}

export function McpManagerPanel({ host }: McpManagerPanelProps) {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [opError, setOpError] = useState<Record<string, string>>({});

  // Fetch server list on mount.
  useEffect(() => {
    fetchFromAgent(host).then((list) => {
      setServers(list);
      setLoading(false);
    });
  }, [host]);

  const refresh = useCallback(async () => {
    const list = await fetchFromAgent(host);
    setServers(list);
  }, [host]);

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setOpError((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
    try {
      await fn();
    } catch (err) {
      setOpError((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setBusyId(null);
    }
  }

  function handleConnect(s: McpServerEntry) {
    withBusy(s.id, async () => {
      await host.bridge.connect(s.name);
      await refresh();
    });
  }

  function handleDisconnect(s: McpServerEntry) {
    host.bridge.disconnect(s.name); refresh();
  }

  function handleReload(s: McpServerEntry) {
    handleConnect(s);
  }

  function handleDelete(s: McpServerEntry) {
    if (confirmDeleteId !== s.id) {
      setConfirmDeleteId(s.id);
      return;
    }
    setConfirmDeleteId(null);
    host.bridge.remove(s.name); refresh();
  }

  if (loading) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>Loading MCP servers...</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>MCP Servers</span>
        <div className={styles.panelHeaderActions}>
          <button
            className={styles.syncBtn}
            onClick={() => refresh()}
            title="Sync status"
          >
            ↺
          </button>
        </div>
      </div>

      <div className={styles.serverList}>
        {servers.length === 0 && !showAdd && (
          <div className={styles.empty}>No MCP servers configured.</div>
        )}

        {servers.map((s) => {
          const busy = busyId === s.id;
          const isConnected = s.status === "connected";
          const isConnecting = s.status === "connecting";
          const expanded = expandedId === s.id;
          const err = opError[s.id];

          return (
            <div
              key={s.id}
              className={`${styles.serverRow} ${expanded ? styles.serverRowExpanded : ""}`}
            >
              <div
                className={styles.serverMain}
                onClick={() => setExpandedId(expanded ? null : s.id)}
              >
                <StatusDot
                  status={busy && !isConnected ? "connecting" : s.status}
                />
                <div className={styles.serverInfo}>
                  <span className={styles.serverName}>{s.name}</span>
                  <span className={styles.serverMeta}>
                    {s.transport.toUpperCase()}
                    {s.useProxy === false
                      ? " \u00B7 direct"
                      : " \u00B7 proxy"}
                    {isConnected &&
                      s.tools.length > 0 &&
                      ` \u00B7 ${s.tools.length} tools`}
                    {s.status === "error" &&
                      s.errorMsg &&
                      ` \u00B7 ${s.errorMsg}`}
                  </span>
                </div>
                <span className={styles.serverChevron}>
                  {expanded ? "\u25B4" : "\u25BE"}
                </span>
              </div>

              {err && <div className={styles.serverError}>{err}</div>}

              {expanded && (
                <div className={styles.serverDetail}>
                  <div className={styles.serverUrl} title={s.url}>
                    {s.url}
                  </div>

                  {isConnected && s.tools.length > 0 && (
                    <div className={styles.toolList}>
                      {s.tools.map((t) => (
                        <span
                          key={t.name}
                          className={styles.toolChip}
                          title={t.description}
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className={styles.serverActions}>
                    {isConnected ? (
                      <>
                        <button
                          className={styles.actionBtn}
                          onClick={() => handleReload(s)}
                          disabled={busy}
                          title="Reconnect"
                        >
                          ↺ Reload
                        </button>
                        <button
                          className={styles.actionBtn}
                          onClick={() => handleDisconnect(s)}
                          disabled={busy}
                          title="Disconnect"
                        >
                          ⏸ Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                        onClick={() => handleConnect(s)}
                        disabled={busy || isConnecting}
                        title="Connect"
                      >
                        {isConnecting ? "Connecting\u2026" : "\u25B6 Connect"}
                      </button>
                    )}

                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger} ${confirmDeleteId === s.id ? styles.actionBtnDangerConfirm : ""}`}
                      onClick={() => handleDelete(s)}
                      disabled={busy}
                      onBlur={() =>
                        setTimeout(
                          () =>
                            setConfirmDeleteId((p) => (p === s.id ? null : p)),
                          200,
                        )
                      }
                      title={
                        confirmDeleteId === s.id
                          ? "Click again to confirm deletion"
                          : "Delete server"
                      }
                    >
                      {confirmDeleteId === s.id
                        ? "Confirm delete?"
                        : "\uD83D\uDDD1 Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAdd ? (
        <AddServerForm
          host={host}
          onAdded={async () => {
            await refresh();
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      ) : (
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          + Add Server
        </button>
      )}
    </div>
  );
}
