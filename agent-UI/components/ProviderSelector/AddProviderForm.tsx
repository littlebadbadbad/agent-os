/**
 * AddProviderForm.tsx — form for creating a custom provider endpoint.
 *
 * Validates every model row client-side (a row counts once id + url are
 * filled), builds a clean ProviderEntry, and persists it through the
 * model-config API. The parent decides what happens after a save.
 */

import { useState } from 'react';
import type { ReactElement } from 'react';
import { addCustomModelProvider } from '../../app/core/model-config';
import {
  API_TYPES,
  DEFAULT_MODEL_ROW,
  isRowComplete,
  toModelConfig,
  userFacingError,
} from './providerConfig';
import type { ApiType, ModelRow } from './providerConfig';
import styles from './ProviderSelector.module.scss';

export interface AddProviderFormProps {
  /** Called after a successful save with the new provider name. */
  onSaved: (providerName: string) => void;
  onCancel: () => void;
}

type SaveState = { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string };

function updateRow(rows: readonly ModelRow[], idx: number, patch: Partial<ModelRow>): ModelRow[] {
  return rows.map((row, i) => (i === idx ? { ...row, ...patch } : row));
}

export function AddProviderForm({ onSaved, onCancel }: AddProviderFormProps): ReactElement {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiType, setApiType] = useState<ApiType>('chat-completions');
  const [rows, setRows] = useState<readonly ModelRow[]>([DEFAULT_MODEL_ROW]);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  const trimmedName = name.trim();
  const completeRows = rows.filter(isRowComplete);
  const canSave = trimmedName !== '' && completeRows.length > 0 && state.kind === 'idle';

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setState({ kind: 'saving' });
    try {
      await addCustomModelProvider({
        name: trimmedName,
        apiKey: apiKey.trim(),
        apiType,
        models: completeRows.map(toModelConfig),
      });
      setState({ kind: 'saved' });
      setTimeout(() => onSaved(trimmedName), 800);
    } catch (err) {
      setState({ kind: 'error', message: userFacingError(err) });
    }
  }

  return (
    <div className={styles.addForm}>
      <div className={styles.addFormField}>
        <label htmlFor="provider-name">提供商名称 *</label>
        <input
          id="provider-name"
          className={styles.addFormInput}
          placeholder="如: my-custom-provider"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className={styles.addFormField}>
        <label htmlFor="provider-key">API Key（可选，也可在 API Keys 页设置）</label>
        <input
          id="provider-key"
          type="password"
          className={styles.addFormInput}
          placeholder="sk-..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      <div className={styles.addFormField}>
        <label htmlFor="provider-type">API 类型</label>
        <select
          id="provider-type"
          className={styles.addFormSelect}
          value={apiType}
          onChange={(e) => setApiType(API_TYPES.find((t) => t === e.target.value) ?? 'chat-completions')}
        >
          {API_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className={styles.addFormModelsHeader}>
        <span>模型列表 *（每个模型需填写 ID 和 URL）</span>
        <button
          type="button"
          className={styles.addFormAddModelBtn}
          onClick={() => setRows((prev) => [...prev, DEFAULT_MODEL_ROW])}
        >
          + 添加模型
        </button>
      </div>

      {rows.map((row, idx) => (
        <div key={idx} className={styles.addModelRow}>
          {idx > 0 && (
            <button
              type="button"
              className={styles.addModelRemoveBtn}
              onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
              title="删除此模型"
              aria-label="删除此模型"
            >
              ✕
            </button>
          )}
          <div className={styles.addModelRowIdName}>
            <input
              className={styles.addFormInput}
              placeholder="模型 ID *"
              value={row.id}
              onChange={(e) => setRows((prev) => updateRow(prev, idx, { id: e.target.value }))}
            />
            <input
              className={styles.addFormInput}
              placeholder="显示名称"
              value={row.name}
              onChange={(e) => setRows((prev) => updateRow(prev, idx, { name: e.target.value }))}
            />
          </div>
          <input
            className={styles.addFormInput}
            placeholder="API URL *"
            value={row.url}
            onChange={(e) => setRows((prev) => updateRow(prev, idx, { url: e.target.value }))}
          />
          <div className={styles.addModelRowChecks}>
            <label className={styles.addModelCheck}>
              <input
                type="checkbox"
                checked={row.toolCalling}
                onChange={(e) => setRows((prev) => updateRow(prev, idx, { toolCalling: e.target.checked }))}
              />
              Tools
            </label>
            <label className={styles.addModelCheck}>
              <input
                type="checkbox"
                checked={row.vision}
                onChange={(e) => setRows((prev) => updateRow(prev, idx, { vision: e.target.checked }))}
              />
              Vision
            </label>
            <label className={styles.addModelCheck}>
              <span>MaxIn:</span>
              <input
                type="number"
                min={1}
                className={styles.addFormSmallInput}
                value={row.maxInputTokens}
                onChange={(e) => setRows((prev) => updateRow(prev, idx, { maxInputTokens: Number(e.target.value) }))}
              />
            </label>
            <label className={styles.addModelCheck}>
              <span>MaxOut:</span>
              <input
                type="number"
                min={1}
                className={styles.addFormSmallInput}
                value={row.maxOutputTokens}
                onChange={(e) => setRows((prev) => updateRow(prev, idx, { maxOutputTokens: Number(e.target.value) }))}
              />
            </label>
          </div>
        </div>
      ))}

      <div className={styles.addFormActions}>
        {state.kind === 'error' && <span className={styles.addFormError}>{state.message}</span>}
        {state.kind === 'saved' && <span className={styles.addFormSuccess}>✓ 添加成功</span>}
        {state.kind === 'idle' && !canSave && (
          <span className={styles.addFormHint}>
            {trimmedName === '' ? '请输入提供商名称' : '至少填写一个模型的 ID 和 URL'}
          </span>
        )}
        <button
          type="button"
          className={styles.editConfigBtn}
          onClick={handleSave}
          disabled={!canSave}
        >
          {state.kind === 'saving' ? '保存中…' : '保存提供商'}
        </button>
        <button type="button" className={styles.editConfigBtnSecondary} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
