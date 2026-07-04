/**
 * WorkItemChildrenEditor
 * ──────────────────────
 * Manages the list of child work items inside the edit form:
 *   • Shows existing children (with a remove button)
 *   • Shows newly-added (unsaved) children (with an undo button)
 *   • Provides a ParentWorkItemPicker to search and add new children
 *
 * All mutation is handled via callbacks — this component is purely presentational
 * with localised picker state.
 */

import React, { useState } from 'react';
import { ParentWorkItemPicker } from './ParentWorkItemPicker';
import type { ParentCandidate } from './ParentWorkItemPicker';
import styles from './WorkItems.module.scss';

export interface ChildEntry {
  id: number;
  title: string;
  type: string;
  state: string;
  _relationIndex: number;
}

interface WorkItemChildrenEditorProps {
  collectionUrl: string;
  project: string;
  pat: string;
  /** Existing (already-saved) children. */
  children: ChildEntry[];
  /** Children that have been added in this session but not yet saved. */
  newChildren: ParentCandidate[];
  disabled: boolean;
  onRemoveExisting: (child: ChildEntry) => void;
  onRemoveNew: (id: number) => void;
  onAdd: (candidate: ParentCandidate) => void;
}

export function WorkItemChildrenEditor({
  collectionUrl,
  project,
  pat,
  children,
  newChildren,
  disabled,
  onRemoveExisting,
  onRemoveNew,
  onAdd,
}: WorkItemChildrenEditorProps) {
  const [pickerValue, setPickerValue] = useState<ParentCandidate | null>(null);

  function handlePickerChange(candidate: ParentCandidate | null) {
    if (!candidate) return;
    onAdd(candidate);
    setPickerValue(null);
  }

  return (
    <div className={styles.customFieldsSection}>
      <div className={styles.customFieldsHeading}>子工作项</div>

      {children.map((child) => (
        <div key={child.id} className={styles.childRow}>
          <span className={styles.childId}>#{child.id}</span>
          {child.type  && <span className={styles.childType}>{child.type}</span>}
          <span className={styles.childTitle}>{child.title}</span>
          {child.state && <span className={styles.childState}>{child.state}</span>}
          <button
            type="button"
            className={styles.childRemoveBtn}
            onClick={() => onRemoveExisting(child)}
            title="移除子工作项"
            disabled={disabled}
          >
            ✕
          </button>
        </div>
      ))}

      {newChildren.map((child) => (
        <div key={child.id} className={`${styles.childRow} ${styles.childRowNew}`}>
          <span className={styles.childId}>#{child.id}</span>
          {child.type && <span className={styles.childType}>{child.type}</span>}
          <span className={styles.childTitle}>{child.title}</span>
          <span className={styles.childNewBadge}>新增</span>
          <button
            type="button"
            className={styles.childRemoveBtn}
            onClick={() => onRemoveNew(child.id)}
            title="撤销添加"
            disabled={disabled}
          >
            ✕
          </button>
        </div>
      ))}

      <div className={styles.childPickerRow}>
        <span className={styles.childPickerLabel}>添加子工作项：</span>
        <div className={styles.childPickerInput}>
          <ParentWorkItemPicker
            collectionUrl={collectionUrl}
            project={project}
            pat={pat}
            value={pickerValue}
            onChange={handlePickerChange}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
