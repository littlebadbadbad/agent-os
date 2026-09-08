/**
 * EditConfigPane.tsx — the "编辑配置" tab: JSON editor for the custom
 * provider config, plus the add-provider form and removable provider chips.
 *
 * The editor is the source of truth for the custom config file. Every save
 * parses and validates the JSON client-side before hitting the backend, so
 * users get an inline message instead of a server round-trip failure.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { providerConfigStore } from '../../store/providerConfigStore';
import {
  fetchCustomModelConfig,
  removeCustomModelProvider,
  saveCustomModelConfig,
} from '../../app/core/model-config';
import { parseConfigJson, userFacingError, validateProviderConfig } from './providerConfig';
import { AddProviderForm } from './AddProviderForm';
import styles from './ProviderSelector.module.scss';

export interface EditConfigPaneProps {
  readonly builtInCount: number;
  readonly customNames: readonly string[];
}

type EditorState = { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string };

async function readCustomJson(): Promise<string> {
  const custom = await fetchCustomModelConfig();
  return JSON.stringify(custom, null, 2);
}

export function EditConfigPane({ builtInCount, customNames }: EditConfigPaneProps): ReactElement {
  const [content, setContent] = useState('');
  const [state, setState] = useState<EditorState>({ kind: 'idle' });
  const [showAddForm, setShowAddForm] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    readCustomJson().then(
      (json) => setContent(json),
      () => setState({ kind: 'error', message: '无法加载自定义配置' }),
    );
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  /** Re-read the custom config from the backend into both the store and editor. */
  async function refresh(): Promise<void> {
    await providerConfigStore.reloadCustom();
    try {
      setContent(await readCustomJson());
    } catch {
      /* editor keeps its previous content */
    }
  }

  async function handleSave(): Promise<void> {
    const parsed = parseConfigJson(content);
    if (!parsed.ok) {
      setState({ kind: 'error', message: parsed.error });
      return;
    }
    const validated = validateProviderConfig(parsed.value);
    if (!validated.ok) {
      setState({ kind: 'error', message: validated.error });
      return;
    }
    setState({ kind: 'saving' });
    try {
      await saveCustomModelConfig(validated.value);
      await providerConfigStore.reloadCustom();
      setContent(JSON.stringify(validated.value, null, 2));
      setState({ kind: 'saved' });
    } catch (err) {
      setState({ kind: 'error', message: userFacingError(err) });
    }
  }

  async function handleRemove(name: string): Promise<void> {
    try {
      await removeCustomModelProvider(name);
      await refresh();
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: userFacingError(err) });
    }
  }

  return (
    <div className={styles.editConfigPane}>
      <p className={styles.keysNote}>
        编辑 <code>data/custom-provider-config.json</code> 自定义提供商和模型。
        内置配置（只读）和自定义配置自动合并，同名提供商以自定义为准。
      </p>

      <div className={styles.editConfigToolbar}>
        <button
          type="button"
          className={styles.editConfigBtn}
          onClick={() => {
            refresh().then(() => setState({ kind: 'idle' }));
          }}
        >
          🔄 重新加载
        </button>
        <button
          type="button"
          className={styles.editConfigBtn}
          onClick={() => setShowAddForm((prev) => !prev)}
        >
          {showAddForm ? '✕ 关闭表单' : '➕ 添加自定义端点'}
        </button>
        <span className={styles.editConfigBadge}>
          内置 {builtInCount} / 自定义 {customNames.length}
        </span>
      </div>

      {showAddForm && (
        <AddProviderForm
          onSaved={() => {
            setShowAddForm(false);
            refresh();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {customNames.length > 0 && (
        <div className={styles.customProviderList}>
          <div className={styles.customProviderListLabel}>自定义提供商（点击移除）：</div>
          {customNames.map((name) => (
            <div key={name} className={styles.customProviderChip}>
              <span>{name}</span>
              <button
                type="button"
                className={styles.customProviderChipRemove}
                onClick={() => handleRemove(name)}
                title="从自定义配置移除"
                aria-label={`移除 ${name}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.jsonEditorSection}>
        <div className={styles.jsonEditorHeader}>
          <span>自定义配置文件 (JSON)</span>
          <div className={styles.jsonEditorActions}>
            {state.kind === 'saved' && <span className={styles.jsonEditorOk}>✓ 已保存</span>}
            {state.kind === 'error' && (
              <span className={styles.jsonEditorErr} title={state.message}>
                {state.message}
              </span>
            )}
            <button
              type="button"
              className={styles.editConfigBtn}
              onClick={handleSave}
              disabled={state.kind === 'saving'}
            >
              {state.kind === 'saving' ? '保存中…' : '💾 保存 JSON'}
            </button>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          className={styles.jsonEditorTextarea}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setState({ kind: 'idle' });
          }}
          spellCheck={false}
          rows={12}
        />
      </div>
    </div>
  );
}
