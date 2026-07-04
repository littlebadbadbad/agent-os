/**
 * AddProviderForm.tsx — Self-contained form for adding a custom provider endpoint.
 *
 * Extracted from ProviderSelector to isolate the add-provider flow:
 *   - Provider name, API key, apiType, and model list
 *   - All 3 apiType options are now available (chat-completions, messages, responses)
 *   - Calls addCustomModelProvider() on save, then reloads the store
 *
 * @module AddProviderForm
 */

import { useState } from 'react';
import type { ApiType } from '../../store/providerConfigStore';
import { API_TYPES } from '../../store/providerConfigStore';
import { addCustomModelProvider } from '../../api/providerConfigApi';
import { providerConfigStore } from '../../store/providerConfigStore';
import styles from './ProviderSelector.module.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelRow {
  id: string;
  name: string;
  url: string;
  toolCalling: boolean;
  vision: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface AddProviderFormProps {
  /** Called after a successful save (parent can reload config list). */
  onSaved: () => void;
  /** Called when the user cancels / closes the form. */
  onCancel: () => void;
}

// ── Default model row (used when adding a new model entry) ────────────────────

const DEFAULT_MODEL_ROW: ModelRow = {
  id: '',
  name: '',
  url: '',
  toolCalling: true,
  vision: false,
  maxInputTokens: 128000,
  maxOutputTokens: 8192,
};

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Form to add a new custom provider endpoint.
 * Manages its own state entirely; parent only needs onSaved/onCancel callbacks.
 */
export function AddProviderForm({ onSaved, onCancel }: AddProviderFormProps) {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiType, setApiType] = useState<ApiType>('chat-completions');
  const [models, setModels] = useState<ModelRow[]>([{ ...DEFAULT_MODEL_ROW }]);
  const [status, setStatus] = useState<string>('');

  // ── Helpers ────────────────────────────────────────────────────────────

  function resetForm() {
    setName('');
    setApiKey('');
    setApiType('chat-completions');
    setModels([{ ...DEFAULT_MODEL_ROW }]);
    setStatus('');
  }

  function updateModelField(idx: number, field: keyof ModelRow, value: string | boolean | number) {
    setModels((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function addModelRow() {
    setModels((prev) => [...prev, { ...DEFAULT_MODEL_ROW }]);
  }

  function removeModelRow(idx: number) {
    setModels((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Submit ─────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!name.trim()) { setStatus('请输入提供商名称'); return; }
    if (!models[0]?.id.trim() || !models[0]?.url.trim()) {
      setStatus('至少需要填写一个模型的 ID 和 URL');
      return;
    }

    try {
      setStatus('saving');
      await addCustomModelProvider({
        name: name.trim(),
        vendor: 'customendpoint',
        apiKey: apiKey.trim(),
        apiType,
        models: models.filter((m) => m.id.trim() && m.url.trim()),
      });
      await providerConfigStore.reloadCustom();
      setStatus('ok');
      setTimeout(() => { resetForm(); onSaved(); }, 1200);
    } catch (err) {
      setStatus(`添加失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className={styles.addForm}>
      {/* Provider name */}
      <div className={styles.addFormField}>
        <label>提供商名称 *</label>
        <input
          type="text"
          className={styles.addFormInput}
          placeholder="如: my-custom-provider"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* API Key */}
      <div className={styles.addFormField}>
        <label>API Key（可选，可在 Keys 标签页设置）</label>
        <input
          type="password"
          className={styles.addFormInput}
          placeholder="sk-..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      {/* API Type — all 3 options */}
      <div className={styles.addFormField}>
        <label>API 类型</label>
        <select
          className={styles.addFormSelect}
          value={apiType}
          onChange={(e) => setApiType(e.target.value as ApiType)}
        >
          {API_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Model list header */}
      <div className={styles.addFormModelsHeader}>
        <span>模型列表 *</span>
        <button className={styles.addFormAddModelBtn} onClick={addModelRow}>
          + 添加模型
        </button>
      </div>

      {/* Model rows */}
      {models.map((model, idx) => (
        <div key={idx} className={styles.addModelRow}>
          <div className={styles.addModelRowFields}>
            <input
              type="text"
              className={styles.addFormInput}
              placeholder="模型 ID *"
              value={model.id}
              onChange={(e) => updateModelField(idx, 'id', e.target.value)}
            />
            <input
              type="text"
              className={styles.addFormInput}
              placeholder="显示名称"
              value={model.name}
              onChange={(e) => updateModelField(idx, 'name', e.target.value)}
            />
            <input
              type="text"
              className={styles.addFormInput}
              placeholder="API URL *"
              value={model.url}
              onChange={(e) => updateModelField(idx, 'url', e.target.value)}
            />
          </div>
          <div className={styles.addModelRowChecks}>
            <label className={styles.addModelCheck}>
              <input
                type="checkbox"
                checked={model.toolCalling}
                onChange={(e) => updateModelField(idx, 'toolCalling', e.target.checked)}
              /> Tools
            </label>
            <label className={styles.addModelCheck}>
              <input
                type="checkbox"
                checked={model.vision}
                onChange={(e) => updateModelField(idx, 'vision', e.target.checked)}
              /> Vision
            </label>
            <label className={styles.addModelCheck}>
              MaxIn:
              <input
                type="number"
                className={styles.addFormSmallInput}
                value={model.maxInputTokens}
                onChange={(e) => updateModelField(idx, 'maxInputTokens', Number(e.target.value))}
              />
            </label>
            <label className={styles.addModelCheck}>
              MaxOut:
              <input
                type="number"
                className={styles.addFormSmallInput}
                value={model.maxOutputTokens}
                onChange={(e) => updateModelField(idx, 'maxOutputTokens', Number(e.target.value))}
              />
            </label>
            {models.length > 1 && (
              <button
                className={styles.addModelRemoveBtn}
                onClick={() => removeModelRow(idx)}
                title="删除此模型"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Actions */}
      <div className={styles.addFormActions}>
        {status && status !== 'saving' && status !== 'ok' && (
          <span className={styles.addFormError}>{status}</span>
        )}
        {status === 'ok' && <span className={styles.addFormSuccess}>✓ 添加成功</span>}
        <button
          className={styles.editConfigBtn}
          onClick={handleSave}
          disabled={status === 'saving'}
        >
          {status === 'saving' ? '保存中…' : '保存提供商'}
        </button>
        <button className={styles.editConfigBtnSecondary} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
