/**
 * MCP Manager Panel — iframe UI for managing MCP servers.
 *
 * Self-contained: manages its own state by calling agent-side methods
 * via `host.bridge`. No dependency on ToolSet state or backend calls.
 *
 * Supports all three MCP transports:
 *   streamable-http — MCP 2025-03-26 (single POST+GET endpoint)
 *   legacy-sse      — MCP 2024-11-05 (deprecated, separate SSE+POST)
 *   stdio           — subprocess stdin/stdout
 *
 * Layout:
 *   .panel → .panelHeader (fixed) + .scrollArea (scrollable)
 *   scrollArea contains server list + add form as a single scroll unit.
 */

import { useState, useEffect, useCallback } from 'react';
import type { UiPluginHost, PluginStateExtension } from '@agent-type';
import type {
  McpTransport,
  McpServerStatus,
  McpServerEntry,
  McpBridge,
} from '../agent/types';

const MCP_TRANSPORTS: McpTransport[] = ['streamable-http', 'legacy-sse', 'stdio'];

const TRANSPORT_LABELS: Record<McpTransport, string> = {
  'streamable-http': 'Streamable HTTP (recommended)',
  'legacy-sse': 'SSE (legacy)',
  'stdio': 'stdio (subprocess)',
};

const IS_STDIO = (t: McpTransport): boolean => t === 'stdio';

import styles from './styles.module.scss';

// ═══════════════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════════════

export interface McpManagerPanelProps {
  readonly host: UiPluginHost<PluginStateExtension, McpBridge>;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Status Dot
// ═══════════════════════════════════════════════════════════════════════════════

function StatusDot({ status }: { status: McpServerStatus }) {
  const cls = {
    connected: styles.dotConnected,
    connecting: styles.dotConnecting,
    error: styles.dotError,
    disconnected: styles.dotDisconnected,
  }[status];
  return <span className={`${styles.dot} ${cls}`} />;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Add-Server Form
// ═══════════════════════════════════════════════════════════════════════════════

interface AddFormProps {
  onAdded: () => void;
  onCancel: () => void;
  host: UiPluginHost<PluginStateExtension, McpBridge>;
}

function AddServerForm({ onAdded, onCancel, host }: AddFormProps) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [transport, setTransport] = useState<McpTransport>('streamable-http');
  const [headersRaw, setHeadersRaw] = useState('');
  const [useProxy, setUseProxy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStdio = IS_STDIO(transport);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      let headers: Record<string, string> | undefined;
      if (!isStdio && headersRaw.trim()) {
        try {
          headers = JSON.parse(headersRaw);
        } catch {
          throw new Error('Headers must be valid JSON, e.g. {"Authorization":"Bearer xxx"}');
        }
      }
      await host.bridge.addServer({
        name: name.trim(),
        url: endpoint.trim(),
        transport,
        headers,
        useProxy: isStdio ? false : useProxy,
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

      {isStdio ? (
        <>
          <label className={styles.addLabel}>Command *</label>
          <input
            className={styles.addInput}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="npx @modelcontextprotocol/server-github"
            required
            disabled={saving}
          />
        </>
      ) : (
        <>
          <label className={styles.addLabel}>URL *</label>
          <input
            className={styles.addInput}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            required
            disabled={saving}
            type="url"
          />
        </>
      )}

      <label className={styles.addLabel}>Transport</label>
      <div className={styles.transportRow}>
        {MCP_TRANSPORTS.map((t) => (
          <button
            key={t}
            type="button"
            className={`${styles.transportBtn} ${transport === t ? styles.transportBtnActive : ''}`}
            onClick={() => setTransport(t)}
            disabled={saving}
          >
            {TRANSPORT_LABELS[t]}
          </button>
        ))}
      </div>

      {isStdio ? (
        <div className={styles.addError}>
          stdio servers use the command as the MCP server process to spawn.
          Headers and proxy options do not apply.
        </div>
      ) : (
        <>
          <label className={styles.proxyToggle}>
            <input
              type="checkbox"
              checked={useProxy}
              onChange={(e) => setUseProxy(e.target.checked)}
              disabled={saving}
            />
            Use proxy (route through system proxy)
          </label>

          <label className={styles.addLabel}>Headers (optional JSON)</label>
          <input
            className={styles.addInput}
            value={headersRaw}
            onChange={(e) => setHeadersRaw(e.target.value)}
            placeholder='{"Authorization":"Bearer <token>"}'
            disabled={saving}
          />
        </>
      )}

      {error && <div className={styles.addError}>{error}</div>}

      <div className={styles.addActions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={saving || !name.trim() || !endpoint.trim()}
        >
          {saving ? 'Connecting\u2026' : 'Connect'}
        </button>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main Panel
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchFromAgent(
  host: UiPluginHost<PluginStateExtension, McpBridge>,
): Promise<McpServerEntry[]> {
  try {
    const list = await host.bridge.sync();
    return [...list];
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
      const next = { ...prev };
      delete next[id];
      return next;
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

  function handleConnect(entry: McpServerEntry) {
    withBusy(entry.id, async () => {
      await host.bridge.connect(entry.name);
      await refresh();
    });
  }

  function handleDisconnect(entry: McpServerEntry) {
    host.bridge.disconnect(entry.name);
    refresh();
  }

  function handleDelete(entry: McpServerEntry) {
    if (confirmDeleteId !== entry.id) {
      setConfirmDeleteId(entry.id);
      return;
    }
    setConfirmDeleteId(null);
    host.bridge.remove(entry.name);
    refresh();
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
          <button className={styles.syncBtn} onClick={() => refresh()} title="Sync status">
            {'\u21BA'}
          </button>
        </div>
      </div>

      <div className={styles.scrollArea}>
        <div className={styles.serverList}>
          {servers.length === 0 && !showAdd && (
            <div className={styles.empty}>No MCP servers configured.</div>
          )}

          {servers.map((entry) => {
            const busy = busyId === entry.id;
            const isConnected = entry.status === 'connected';
            const isConnecting = entry.status === 'connecting';
            const expanded = expandedId === entry.id;
            const err = opError[entry.id];

            return (
              <div
                key={entry.id}
                className={`${styles.serverRow} ${expanded ? styles.serverRowExpanded : ''}`}
              >
                <div
                  className={styles.serverMain}
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                >
                  <StatusDot status={busy && !isConnected ? 'connecting' : entry.status} />
                  <div className={styles.serverInfo}>
                    <span className={styles.serverName}>{entry.name}</span>
                    <span className={styles.serverMeta}>
                      {entry.transport.toUpperCase()}
                      {isConnected && entry.tools.length > 0 && ` \u00B7 ${entry.tools.length} tools`}
                      {entry.status === 'error' && entry.errorMsg && ` \u00B7 ${entry.errorMsg}`}
                    </span>
                  </div>
                  <span className={styles.serverChevron}>
                    {expanded ? '\u25B4' : '\u25BE'}
                  </span>
                </div>

                {err && <div className={styles.serverError}>{err}</div>}

                {expanded && (
                  <div className={styles.serverDetail}>
                    <div className={styles.serverUrl} title={entry.url}>
                      {entry.url}
                    </div>

                    {isConnected && entry.tools.length > 0 && (
                      <div className={styles.toolList}>
                        {entry.tools.map((t) => (
                          <span key={t.name} className={styles.toolChip} title={t.description}>
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
                            onClick={() => handleConnect(entry)}
                            disabled={busy}
                            title="Reconnect"
                          >
                            {'\u21BA'} Reload
                          </button>
                          <button
                            className={styles.actionBtn}
                            onClick={() => handleDisconnect(entry)}
                            disabled={busy}
                            title="Disconnect"
                          >
                            {'\u23F8'} Disconnect
                          </button>
                        </>
                      ) : (
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                          onClick={() => handleConnect(entry)}
                          disabled={busy || isConnecting}
                          title="Connect"
                        >
                          {isConnecting ? 'Connecting\u2026' : '\u25B6 Connect'}
                        </button>
                      )}

                      <button
                        className={`${styles.actionBtn} ${styles.actionBtnDanger} ${confirmDeleteId === entry.id ? styles.actionBtnDangerConfirm : ''}`}
                        onClick={() => handleDelete(entry)}
                        disabled={busy}
                        onBlur={() =>
                          setTimeout(
                            () => setConfirmDeleteId((prev) => (prev === entry.id ? null : prev)),
                            200,
                          )
                        }
                        title={
                          confirmDeleteId === entry.id
                            ? 'Click again to confirm deletion'
                            : 'Delete server'
                        }
                      >
                        {confirmDeleteId === entry.id ? 'Confirm delete?' : '\uD83D\uDDD1 Delete'}
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
    </div>
  );
}
