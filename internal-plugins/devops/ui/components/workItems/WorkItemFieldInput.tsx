/**
 * WorkItemFieldInput.tsx
 * ──────────────────────
 * Smart field renderer for a single ADO WorkItem field.
 *
 * Responsibility:
 *   – Resolve the correct UI widget via `resolveFieldKind`
 *   – Lazily load allowed values via `useFieldOptions` (only when needed)
 *   – Render the appropriate HTML element with the right semantics
 *
 * It intentionally knows nothing about the surrounding form state; the caller
 * owns the value and passes an `onChange` callback.
 *
 * Widget matrix:
 *   readonly    → <span> (no editing)
 *   boolean     → <input type="checkbox">
 *   number      → <input type="number">
 *   date        → <input type="datetime-local"> (ISO round-trip via ADO)
 *   textarea    → <textarea>
 *   select      → <select>  (strict — only listed values allowed)
 *   combobox    → <input list="..."> + <datalist>  (picklist + free text fallback)
 *   autocomplete→ <input list="..."> + <datalist>  (identity/member filter)
 *   text        → <input type="text">
 */

import React, { useId } from 'react';
import type { WorkItemFieldDef } from '../../api/types';
import { resolveFieldKind } from './fieldConfig';
import { useFieldOptions } from './useFieldOptions';
import { ComboSelect } from '../shared/ComboSelect';
import { RichTextEditor } from '../shared/RichTextEditor';
import styles from './WorkItems.module.scss';

export interface WorkItemFieldInputProps {
  /** Full field metadata from ADO */
  field: WorkItemFieldDef;
  /** Current string value (always string; coercion happens at submit time) */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;

  // Context needed by useFieldOptions to fetch remote allowed values
  collectionUrl: string;
  project: string;
  pat: string;
  /** Work-item type name — required to call the per-type allowed-values endpoint */
  workItemType: string;
  /** Project member display names — used as option source for identity fields */
  members?: string[];
}

export function WorkItemFieldInput({
  field,
  value,
  onChange,
  disabled = false,
  collectionUrl,
  project,
  pat,
  workItemType,
  members = [],
}: WorkItemFieldInputProps) {
  const kind = resolveFieldKind(field);
  const { options, loading } = useFieldOptions(
    collectionUrl,
    project,
    pat,
    workItemType,
    field,
    members,
  );

  // Stable id used only by the boolean checkbox label association
  const checkboxId = useId();

  if (kind === 'readonly') {
    return (
      <span className={styles.fieldInputReadonly}>
        {value || '—'}
      </span>
    );
  }

  if (kind === 'boolean') {
    return (
      <div className={styles.fieldCheckbox}>
        <input
          type="checkbox"
          id={checkboxId}
          checked={value === 'true' || value === '1'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          disabled={disabled}
        />
        <label htmlFor={checkboxId}>{field.name}</label>
      </div>
    );
  }

  if (kind === 'number') {
    return (
      <input
        className={styles.editInput}
        type="number"
        value={value}
        step={field.type === 'double' || field.type === 'picklistDouble' ? 'any' : '1'}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={field.referenceName}
      />
    );
  }

  if (kind === 'date') {
    // Normalise ISO datetime string to datetime-local format (strip seconds/ms/Z)
    const localValue = value ? value.replace(/(\.\d+)?Z$/, '').slice(0, 16) : '';
    return (
      <input
        className={styles.editInput}
        type="datetime-local"
        value={localValue}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}:00Z` : '')}
        disabled={disabled}
      />
    );
  }

  if (kind === 'richtext') {
    return (
      <RichTextEditor
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={field.referenceName}
      />
    );
  }

  if (kind === 'textarea') {
    return (
      <textarea
        className={styles.editTextarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={4}
        placeholder={field.referenceName}
      />
    );
  }

  if (kind === 'select') {
    return (
      <ComboSelect
        value={value}
        onChange={onChange}
        options={loading ? [] : options}
        placeholder={loading ? '加载中…' : '—'}
        disabled={disabled || loading}
        allowFreeText={false}
        clearable
      />
    );
  }

  if (kind === 'combobox') {
    return (
      <ComboSelect
        value={value}
        onChange={onChange}
        options={loading ? [] : options}
        placeholder={loading ? '加载选项…' : field.referenceName}
        disabled={disabled}
        allowFreeText
        clearable
      />
    );
  }

  if (kind === 'autocomplete') {
    return (
      <ComboSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder="输入姓名…"
        disabled={disabled}
        allowFreeText
        clearable
      />
    );
  }

  // Default: plain text
  return (
    <input
      className={styles.editInput}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={field.referenceName}
    />
  );
}
