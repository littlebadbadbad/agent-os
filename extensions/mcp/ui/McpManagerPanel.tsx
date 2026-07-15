/**
 * extensions/mcp/ui/McpManagerPanel.tsx — dropdown panel for managing MCP servers.
 *
 * All operations go through the ToolSet state functions passed via props.
 * No global mcpToolset import — all data and mutations flow through the
 * ToolSet's onGetSymbolState contract.
 *
 * Capabilities:
 *  • List all servers with status indicator + tool count
 *  • Connect / disconnect / reload individual servers
 *  • Delete a server (with inline confirmation)
 *  • Add a new server (inline form: name, url, transport, optional headers)
 */

import { useState } from "react";
import type {
  McpTransport,
  McpServerStatus,
  McpServerEntry,
} from "../agent/types";

const MCP_TRANSPORTS: McpTransport[] = ["http", "sse"];
import styles from "./styles.module.scss";

interface McpManagerPanelProps {
  servers: McpServerEntry[];
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => void;
  remove: (id: string) => void;
  addServer: (config: {
    name: string;
    url: string;
    transport: McpTransport;
    headers?: Record<string, string>;
    includeTools?: string[];
    enabled?: boolean;
  }) => Promise<McpServerEntry>;
  onSync: () => Promise<McpServerEntry[]>;
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
  addServer: McpManagerPanelProps["addServer"];
}

function AddServerForm({ onAdded, onCancel, addServer }: AddFormProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<McpTransport>("http");
  const [headersRaw, setHeadersRaw] = useState("");
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
      await addServer({
        name: name.trim(),
        url: url.trim(),
        transport,
        headers,
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

export function McpManagerPanel({
  servers,
  connect,
  disconnect,
  remove,
  addServer,
  onSync,
}: McpManagerPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [opError, setOpError] = useState<Record<string, string>>({});

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
    withBusy(s.id, () => connect(s.id));
  }

  function handleDisconnect(s: McpServerEntry) {
    disconnect(s.id);
  }

  function handleReload(s: McpServerEntry) {
    withBusy(s.id, () => connect(s.id));
  }

  function handleDelete(s: McpServerEntry) {
    if (confirmDeleteId !== s.id) {
      setConfirmDeleteId(s.id);
      return;
    }
    setConfirmDeleteId(null);
    remove(s.id);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>MCP Servers</span>
        <div className={styles.panelHeaderActions}>
          <button
            className={styles.syncBtn}
            onClick={() => onSync()}
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
          addServer={addServer}
          onAdded={async () => {
            await onSync();
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
