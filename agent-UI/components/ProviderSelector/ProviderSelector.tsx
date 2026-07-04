import { useState, useEffect, useRef } from 'react';
import { providerStore } from '../../store/providerStore';
import { providerConfigStore } from '../../store/providerConfigStore';
import type { ProviderEntry } from '../../store/providerConfigStore';
import { DropdownPanel } from '../DropdownPanel';
import { ApiKeyManager } from './ApiKeyManager';
import { AddProviderForm } from './AddProviderForm';
import {
  fetchCustomModelConfig,
  saveCustomModelConfig,
  removeCustomModelProvider,
} from '../../api/providerConfigApi';
import styles from './ProviderSelector.module.scss';

type Tab = 'models' | 'keys' | 'edit-config';
type JsonEditorStatus = 'idle' | 'saving' | 'ok' | 'err';

// ── Icons ─────────────────────────────────────────────────────────────────────

const ICONS = ['✦', '🔮', '☁️', '🧠', '🐋', '⚡', '🔌', '🌐', '⚙️', '📡'];

function providerIcon(index: number): string {
  return ICONS[index % ICONS.length];
}

/** Format context window token count as "1M", "128k", etc. */
function fmtCtx(n: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// ── Fuzzy match: all chars of query appear in-order within text ───────────────

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ProviderSelector() {
  const [providerSel, setProviderSel] = useState(() => providerStore.getSelection());
  useEffect(() => providerStore.subscribe(() => setProviderSel(providerStore.getSelection())), []);

  // ── Load provider config on mount ─────────────────────────────────────────
  const [providers, setProviders] = useState<ProviderEntry[]>(() => providerConfigStore.getProviders());
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    if (!providerConfigStore.isLoaded()) {
      providerConfigStore.load().then(() => {
        setProviders([...providerConfigStore.getProviders()]);
        setConfigLoaded(true);
      });
    } else {
      setProviders([...providerConfigStore.getProviders()]);
      setConfigLoaded(true);
    }
  }, []);

  // Subscribe to config store changes
  useEffect(() => providerConfigStore.subscribe(() => {
    setProviders([...providerConfigStore.getProviders()]);
  }), []);

  const [tab, setTab]     = useState<Tab>('models');
  const [query, setQuery] = useState('');
  const searchRef         = useRef<HTMLInputElement>(null);

  // ── Collapse state: start with all providers collapsed except current ─────────
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(providers.filter((p) => p.name !== providerSel.providerId).map((p) => p.name)),
  );

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const selectedModel = providers
    .flatMap((p) => p.models)
    .find((m) => m.id === providerSel.modelId);

  // Focus search input when switching to the models tab
  useEffect(() => {
    if (tab === 'models') {
      const id = setTimeout(() => searchRef.current?.focus(), 40);
      return () => clearTimeout(id);
    }
  }, [tab]);

  // When searching, force-expand all providers so results are visible
  const isSearching = query.trim().length > 0;

  const filtered = isSearching
    ? providers
        .map((prov) => ({
          ...prov,
          models: prov.models.filter((m) =>
            fuzzyMatch(query, `${prov.name} ${m.id} ${m.name}`),
          ),
        }))
        .filter((prov) => prov.models.length > 0)
    : providers;

  // ── Edit Config tab state ────────────────────────────────────────────────
  const [jsonEditorContent, setJsonEditorContent] = useState('');
  const [jsonEditorStatus, setJsonEditorStatus] = useState<JsonEditorStatus>('idle');
  const [jsonEditorError, setJsonEditorError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const jsonEditorRef = useRef<HTMLTextAreaElement>(null);

  // Load custom config JSON when switching to edit-config tab
  useEffect(() => {
    if (tab !== 'edit-config') return;
    async function load() {
      try {
        const custom = await fetchCustomModelConfig();
        setJsonEditorContent(JSON.stringify(custom, null, 2));
        setJsonEditorError('');
      } catch {
        setJsonEditorContent('[]');
        setJsonEditorError('无法加载自定义配置');
      }
    }
    load();
  }, [tab]);

  // Auto-resize the JSON editor textarea
  useEffect(() => {
    if (tab === 'edit-config' && jsonEditorRef.current) {
      const el = jsonEditorRef.current;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [tab, jsonEditorContent]);

  /** Save the current JSON editor content as the custom config. */
  async function handleJsonSave() {
    try {
      const parsed = JSON.parse(jsonEditorContent);
      if (!Array.isArray(parsed)) {
        setJsonEditorError('配置必须是 JSON 数组格式');
        setJsonEditorStatus('err');
        return;
      }
      setJsonEditorStatus('saving');
      await saveCustomModelConfig(parsed);
      await providerConfigStore.reloadCustom();
      setProviders([...providerConfigStore.getProviders()]);
      setJsonEditorStatus('ok');
      setJsonEditorError('');
      setTimeout(() => setJsonEditorStatus('idle'), 1500);
    } catch (err) {
      setJsonEditorError(err instanceof SyntaxError ? `JSON 格式错误: ${err.message}` : String(err));
      setJsonEditorStatus('err');
    }
  }

  async function handleRemoveCustomProvider(name: string) {
    try {
      await removeCustomModelProvider(name);
      await providerConfigStore.reloadCustom();
      setProviders([...providerConfigStore.getProviders()]);
      const custom = await fetchCustomModelConfig();
      setJsonEditorContent(JSON.stringify(custom, null, 2));
    } catch (err) {
      setJsonEditorError(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Get custom provider names for the edit-config tab
  const customProviderNames = providerConfigStore.getCustomProviders().map((p) => p.name);
  const builtInProviderNames = providerConfigStore.getBuiltInProviders().map((p) => p.name);

  function handleConfigChanged() {
    providerConfigStore.reloadCustom().then(() => {
      setProviders([...providerConfigStore.getProviders()]);
    });
  }

  return (
    <DropdownPanel
      trigger={({ open, toggle }) => (
        <button
          className={styles.providerBtn}
          onClick={toggle}
          title={selectedModel?.id ?? '(no model selected)'}
        >
          <span>{providerIcon(providers.findIndex((p) => p.name === providerSel.providerId))}</span>
          <span className={styles.providerLabel}>{selectedModel?.id ?? '选择模型'}</span>
          <span className={styles.providerChevron}>{open ? '▴' : '▾'}</span>
        </button>
      )}
      onClose={() => setQuery('')}
    >
      {({ close }) => (
        <div className={styles.providerMenu}>

          {/* ── Tab bar ─────────────────────────────────────────────────── */}
          <div className={styles.providerTabs}>
            <button
              className={`${styles.providerTab} ${tab === 'models' ? styles.providerTabActive : ''}`}
              onClick={() => setTab('models')}
            >
              模型
            </button>
            <button
              className={`${styles.providerTab} ${tab === 'keys' ? styles.providerTabActive : ''}`}
              onClick={() => setTab('keys')}
            >
              🔑 API Keys
            </button>
            <button
              className={`${styles.providerTab} ${tab === 'edit-config' ? styles.providerTabActive : ''}`}
              onClick={() => setTab('edit-config')}
            >
              ⚙️ 编辑配置
            </button>
          </div>

          {/* ── Models tab ──────────────────────────────────────────────── */}
          {tab === 'models' && (
            <>
              <div className={styles.providerSearch}>
                <input
                  ref={searchRef}
                  type="text"
                  className={styles.providerSearchInput}
                  placeholder="搜索模型…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className={styles.providerSearchClear}
                    onClick={() => setQuery('')}
                    tabIndex={-1}
                    aria-label="清除搜索"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className={styles.providerList}>
                {!configLoaded && (
                  <div className={styles.providerEmpty}>加载配置中…</div>
                )}
                {configLoaded && filtered.length === 0 && (
                  <div className={styles.providerEmpty}>无匹配模型</div>
                )}
                {filtered.map((prov, idx) => {
                  const isCollapsed = !isSearching && collapsed.has(prov.name);
                  return (
                  <div key={prov.name} className={styles.providerGroup}>
                    <div
                      className={styles.providerGroupLabel}
                      onClick={() => toggleCollapse(prov.name)}
                      role="button"
                      aria-expanded={!isCollapsed}
                    >
                      <span className={`${styles.providerGroupChevron} ${isCollapsed ? styles.providerGroupChevronCollapsed : ''}`}>▾</span>
                      <span>{providerIcon(idx)}</span>
                      {prov.name}
                      <span className={styles.providerDynamicBadge}>
                        {prov.models.length}
                      </span>
                    </div>
                    {!isCollapsed && prov.models.length === 0 && (
                      <div className={styles.providerEmpty}>无已配置模型</div>
                    )}
                    {!isCollapsed && prov.models.map((model) => {
                      const active = prov.name === providerSel.providerId && model.id === providerSel.modelId;
                      const ctx = fmtCtx(model.maxInputTokens);
                      return (
                        <button
                          key={model.id}
                          className={`${styles.providerItem} ${active ? styles.providerItemActive : ''}`}
                          onClick={() => {
                            providerStore.setSelection({ providerId: prov.name, modelId: model.id });
                            close();
                          }}
                        >
                          <span className={styles.providerItemName}>{model.id}</span>
                          <span className={styles.providerItemMeta}>
                            {model.toolCalling && <span className={styles.providerItemOwner}>tools</span>}
                            {model.vision && <span className={styles.providerItemOwner}>vision</span>}
                            {ctx && <span className={styles.providerItemCtx}>{ctx}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── API Keys tab ─────────────────────────────────────────────── */}
          {tab === 'keys' && <ApiKeyManager providerNames={providers.map((p) => p.name)} />}

          {/* ── Edit Config tab ──────────────────────────────────────────── */}
          {tab === 'edit-config' && (
            <div className={styles.editConfigPane}>
              <p className={styles.keysNote}>
                编辑 <code>data/custom-provider-config.json</code> 自定义提供商和模型。
                内置配置（只读）和自定义配置自动合并，同名提供商以自定义为准。
              </p>

              {/* ── Toolbar ──────────────────────────────────────────────── */}
              <div className={styles.editConfigToolbar}>
                <button
                  className={styles.editConfigBtn}
                  onClick={async () => {
                    await providerConfigStore.reloadCustom();
                    setProviders([...providerConfigStore.getProviders()]);
                    const custom = await fetchCustomModelConfig();
                    setJsonEditorContent(JSON.stringify(custom, null, 2));
                    setJsonEditorError('');
                  }}
                >
                  🔄 重新加载
                </button>
                <button
                  className={styles.editConfigBtn}
                  onClick={() => setShowAddForm((prev) => !prev)}
                >
                  {showAddForm ? '✕ 关闭表单' : '➕ 添加自定义端点'}
                </button>
                <span className={styles.editConfigBadge}>
                  内置 {builtInProviderNames.length} / 自定义 {customProviderNames.length}
                </span>
              </div>

              {/* ── Add Custom Provider Form ─────────────────────────────── */}
              {showAddForm && (
                <AddProviderForm
                  onSaved={() => {
                    setShowAddForm(false);
                    handleConfigChanged();
                    fetchCustomModelConfig().then((custom) =>
                      setJsonEditorContent(JSON.stringify(custom, null, 2)),
                    );
                  }}
                  onCancel={() => {
                    setShowAddForm(false);
                  }}
                />
              )}

              {/* ── Custom provider list ─────────────────────────────────── */}
              {customProviderNames.length > 0 && (
                <div className={styles.customProviderList}>
                  <div className={styles.customProviderListLabel}>自定义提供商（点击移除）：</div>
                  {customProviderNames.map((name) => (
                    <div key={name} className={styles.customProviderChip}>
                      <span>{name}</span>
                      <button
                        className={styles.customProviderChipRemove}
                        onClick={() => handleRemoveCustomProvider(name)}
                        title="从自定义配置移除"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── JSON Editor ───────────────────────────────────────────── */}
              <div className={styles.jsonEditorSection}>
                <div className={styles.jsonEditorHeader}>
                  <span>自定义配置文件 (JSON)</span>
                  <div className={styles.jsonEditorActions}>
                    {jsonEditorStatus === 'ok' && <span className={styles.jsonEditorOk}>✓ 已保存</span>}
                    {jsonEditorStatus === 'err' && jsonEditorError && (
                      <span className={styles.jsonEditorErr}>{jsonEditorError}</span>
                    )}
                    <button
                      className={styles.editConfigBtn}
                      onClick={handleJsonSave}
                      disabled={jsonEditorStatus === 'saving'}
                    >
                      {jsonEditorStatus === 'saving' ? '保存中…' : '💾 保存 JSON'}
                    </button>
                  </div>
                </div>
                <textarea
                  ref={jsonEditorRef}
                  className={styles.jsonEditorTextarea}
                  value={jsonEditorContent}
                  onChange={(e) => {
                    setJsonEditorContent(e.target.value);
                    setJsonEditorError('');
                    setJsonEditorStatus('idle');
                  }}
                  spellCheck={false}
                  rows={12}
                />
              </div>
            </div>
          )}

        </div>
      )}
    </DropdownPanel>
  );
}
