/**
 * McpManagerPanel — dropdown panel for viewing and managing MCP servers.
 *
 * Capabilities:
 *  • List all servers with status indicator + tool count
 *  • Connect / disconnect / reload individual servers
 *  • Delete a server (with inline confirmation)
 *  • Add a new server (inline form: name, url, transport, optional headers)
 */

import React, { useState, useRef } from 'react';
import { mcpToolset } from '../../agents';
import type { McpTransport, McpServerStatus, McpServerEntry } from '@agent-sdk';
import styles from './McpManagerPanel.module.scss';
interface McpManagerPanelProps {
  servers: McpServerEntry[];
  onSync: () => Promise<void>;
  onClose: () => void;
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
}

function AddServerForm({ onAdded, onCancel }: AddFormProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<McpTransport>('http');
  const [headersRaw, setHeadersRaw] = useState('');
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
          throw new Error('Headers 必须是合法的 JSON 对象，如 {"Authorization":"Bearer xxx"}');
        }
      }
      await mcpToolset.addServer({ name: name.trim(), url: url.trim(), transport, headers });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <div className={styles.addTitle}>添加 MCP 服务器</div>

      <label className={styles.addLabel}>名称 *</label>
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
        {(['http', 'sse'] as McpTransport[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`${styles.transportBtn} ${transport === t ? styles.transportBtnActive : ''}`}
            onClick={() => setTransport(t)}
            disabled={saving}
          >
            {t === 'http' ? 'HTTP (推荐)' : 'SSE (旧版)'}
          </button>
        ))}
      </div>

      <label className={styles.addLabel}>Headers (可选 JSON)</label>
      <input
        className={styles.addInput}
        value={headersRaw}
        onChange={(e) => setHeadersRaw(e.target.value)}
        placeholder='{"Authorization":"Bearer <token>"}'
        disabled={saving}
      />

      {error && <div className={styles.addError}>{error}</div>}

      <div className={styles.addActions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button type="submit" className={styles.submitBtn} disabled={saving || !name.trim() || !url.trim()}>
          {saving ? '连接中…' : '连接'}
        </button>
      </div>
    </form>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function McpManagerPanel({ servers, onSync, onClose }: McpManagerPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [opError, setOpError] = useState<Record<string, string>>({});

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setOpError((prev) => { const n = { ...prev }; delete n[id]; return n; });
    try {
      await fn();
      // mcpToolset updates its store internally; the reactive subscription in
      // Header.tsx propagates the new server list to this panel via props.
    } catch (err) {
      setOpError((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusyId(null);
    }
  }

  function handleConnect(s: McpServerEntry) {
    withBusy(s.id, () => mcpToolset.connect(s.id));
  }

  function handleDisconnect(s: McpServerEntry) {
    // optimistic fire-and-forget: manager unregisters tools and updates store
    mcpToolset.disconnect(s.id);
  }

  function handleReload(s: McpServerEntry) {
    withBusy(s.id, () => mcpToolset.connect(s.id));
  }

  function handleDelete(s: McpServerEntry) {
    if (confirmDeleteId !== s.id) {
      setConfirmDeleteId(s.id);
      return;
    }
    setConfirmDeleteId(null);
    // optimistic fire-and-forget: manager removes from store and unregisters tools
    mcpToolset.remove(s.id);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>MCP 服务器</span>
        <div className={styles.panelHeaderActions}>
          <button
            className={styles.syncBtn}
            onClick={() => onSync()}
            title="同步状态"
          >
            ↺
          </button>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
      </div>

      <div className={styles.serverList}>
        {servers.length === 0 && !showAdd && (
          <div className={styles.empty}>暂无 MCP 服务器</div>
        )}

        {servers.map((s) => {
          const busy = busyId === s.id;
          const isConnected = s.status === 'connected';
          const isConnecting = s.status === 'connecting';
          const expanded = expandedId === s.id;
          const err = opError[s.id];

          return (
            <div key={s.id} className={`${styles.serverRow} ${expanded ? styles.serverRowExpanded : ''}`}>
              <div className={styles.serverMain} onClick={() => setExpandedId(expanded ? null : s.id)}>
                <StatusDot status={busy && !isConnected ? 'connecting' : s.status} />
                <div className={styles.serverInfo}>
                  <span className={styles.serverName}>{s.name}</span>
                  <span className={styles.serverMeta}>
                    {s.transport.toUpperCase()}
                    {isConnected && s.tools.length > 0 && ` · ${s.tools.length} tools`}
                    {s.status === 'error' && s.errorMsg && ` · ${s.errorMsg}`}
                  </span>
                </div>
                <span className={styles.serverChevron}>{expanded ? '▴' : '▾'}</span>
              </div>

              {err && <div className={styles.serverError}>{err}</div>}

              {expanded && (
                <div className={styles.serverDetail}>
                  <div className={styles.serverUrl} title={s.url}>{s.url}</div>

                  {isConnected && s.tools.length > 0 && (
                    <div className={styles.toolList}>
                      {s.tools.map((t) => (
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
                          onClick={() => handleReload(s)}
                          disabled={busy}
                          title="重新连接"
                        >
                          ↺ 重载
                        </button>
                        <button
                          className={styles.actionBtn}
                          onClick={() => handleDisconnect(s)}
                          disabled={busy}
                          title="断开连接"
                        >
                          ⏸ 断开
                        </button>
                      </>
                    ) : (
                      <button
                        className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                        onClick={() => handleConnect(s)}
                        disabled={busy || isConnecting}
                        title="连接"
                      >
                        {isConnecting ? '连接中…' : '▶ 连接'}
                      </button>
                    )}

                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger} ${confirmDeleteId === s.id ? styles.actionBtnDangerConfirm : ''}`}
                      onClick={() => handleDelete(s)}
                      disabled={busy}
                      onBlur={() => setTimeout(() => setConfirmDeleteId((p) => p === s.id ? null : p), 200)}
                      title={confirmDeleteId === s.id ? '再次点击确认删除' : '删除服务器'}
                    >
                      {confirmDeleteId === s.id ? '确认删除？' : '🗑 删除'}
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
          onAdded={async () => {
            await onSync();
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      ) : (
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          + 添加服务器
        </button>
      )}
    </div>
  );
}
