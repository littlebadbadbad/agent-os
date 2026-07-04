/**
 * ProxyManagerPanel — dropdown panel for viewing and editing backend proxy config.
 */

import React, { useEffect, useState } from 'react';
import { apiTransport } from '../../transport/apiTransport';
import styles from './ProxyManagerPanel.module.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

const PROTOCOLS = ['http', 'https', 'socks5', 'socks4'] as const;
type Protocol = (typeof PROTOCOLS)[number];

interface ProxyConfig {
  enabled: boolean;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  password: string;
  noProxy: string;
  connectTimeout: number;
}

type TestStatus = 'idle' | 'testing' | 'ok' | 'error';

interface ProxyManagerPanelProps {
  onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ProxyManagerPanel({ onClose }: ProxyManagerPanelProps) {
  const [cfg, setCfg] = useState<ProxyConfig | null>(null);
  const [form, setForm] = useState<ProxyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMsg, setTestMsg] = useState<string>('');

  // ── Load config on mount ──────────────────────────────────────────────────
  useEffect(() => {
    apiTransport.get<{ config: ProxyConfig }>('/api/proxy')
      .then(({ config }) => {
        setCfg(config);
        setForm(config);
      })
      .catch((err: Error) => setSaveError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (!form) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>代理设置</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className={styles.loadingMsg}>
          {loading ? '加载中…' : saveError ?? '加载失败'}
        </div>
      </div>
    );
  }

  // ── Field helpers ─────────────────────────────────────────────────────────
  function setField<K extends keyof ProxyConfig>(key: K, value: ProxyConfig[K]) {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    setSaveOk(false);
    setSaveError(null);
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(cfg);

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const { config } = await apiTransport.post<{ config: ProxyConfig }>('/api/proxy', form);
      setCfg(config);
      setForm(config);
      setSaveOk(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // ── Test ──────────────────────────────────────────────────────────────────
  async function handleTest() {
    if (!form) return;
    setTestStatus('testing');
    setTestMsg('');
    try {
      const result = await apiTransport.post<{ ok: boolean; ms?: number; error?: string }>(
        '/api/proxy/test',
        form,
      );
      if (result.ok) {
        setTestStatus('ok');
        setTestMsg(result.ms != null ? `连通 (${result.ms} ms)` : '连通');
      } else {
        setTestStatus('error');
        setTestMsg(result.error ?? '连接失败');
      }
    } catch (err) {
      setTestStatus('error');
      setTestMsg(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const disabled = saving;

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>🔌 代理设置</span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">✕</button>
      </div>

      <div className={styles.body}>
        {/* Enable toggle */}
        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>启用代理</span>
          <button
            type="button"
            className={`${styles.toggle} ${form.enabled ? styles.toggleOn : ''}`}
            onClick={() => setField('enabled', !form.enabled)}
            disabled={disabled}
            aria-pressed={form.enabled}
          >
            <span className={styles.toggleThumb} />
          </button>
        </div>

        {/* Config fields */}
        <div className={`${styles.fields} ${!form.enabled ? styles.fieldsDisabled : ''}`}>

          {/* Protocol */}
          <label className={styles.label}>协议</label>
          <div className={styles.protocolRow}>
            {PROTOCOLS.map((p) => (
              <button
                key={p}
                type="button"
                className={`${styles.protoBtn} ${form.protocol === p ? styles.protoBtnActive : ''}`}
                onClick={() => setField('protocol', p)}
                disabled={disabled || !form.enabled}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Host + Port */}
          <div className={styles.hostPortRow}>
            <div className={styles.hostGroup}>
              <label className={styles.label}>主机</label>
              <input
                className={styles.input}
                value={form.host}
                onChange={(e) => setField('host', e.target.value)}
                placeholder="localhost"
                disabled={disabled || !form.enabled}
              />
            </div>
            <div className={styles.portGroup}>
              <label className={styles.label}>端口</label>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => setField('port', Number(e.target.value))}
                disabled={disabled || !form.enabled}
              />
            </div>
          </div>

          {/* Username */}
          <label className={styles.label}>用户名 <span className={styles.optional}>(可选)</span></label>
          <input
            className={styles.input}
            value={form.username}
            onChange={(e) => setField('username', e.target.value)}
            placeholder="留空则无认证"
            autoComplete="off"
            disabled={disabled || !form.enabled}
          />

          {/* Password */}
          <label className={styles.label}>密码 <span className={styles.optional}>(可选)</span></label>
          <input
            className={styles.input}
            type="password"
            value={form.password}
            onChange={(e) => setField('password', e.target.value)}
            placeholder="留空则无认证"
            autoComplete="new-password"
            disabled={disabled || !form.enabled}
          />

          {/* No-proxy */}
          <label className={styles.label}>不走代理 <span className={styles.optional}>(逗号分隔)</span></label>
          <input
            className={styles.input}
            value={form.noProxy}
            onChange={(e) => setField('noProxy', e.target.value)}
            placeholder="localhost,127.0.0.1"
            disabled={disabled || !form.enabled}
          />

          {/* Connect timeout */}
          <label className={styles.label}>连接超时 <span className={styles.optional}>(毫秒)</span></label>
          <input
            className={styles.input}
            type="number"
            min={500}
            step={500}
            value={form.connectTimeout}
            onChange={(e) => setField('connectTimeout', Number(e.target.value))}
            disabled={disabled || !form.enabled}
          />
        </div>

        {/* Test result */}
        {testStatus !== 'idle' && (
          <div className={`${styles.testResult} ${styles[`testResult_${testStatus}`]}`}>
            {testStatus === 'testing' && '测试中…'}
            {testStatus !== 'testing' && testMsg}
          </div>
        )}

        {/* Save error / success */}
        {saveError && <div className={styles.errorMsg}>{saveError}</div>}
        {saveOk && !dirty && <div className={styles.successMsg}>✓ 已保存</div>}

        {/* Actions */}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.testBtn}
            onClick={handleTest}
            disabled={saving || testStatus === 'testing'}
          >
            {testStatus === 'testing' ? '测试中…' : '测试连通性'}
          </button>
          <button
            type="button"
            className={`${styles.saveBtn} ${!dirty ? styles.saveBtnDisabled : ''}`}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
