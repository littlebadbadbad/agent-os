/**
 * internal-apps/experience/ui/ExperiencePanel.tsx — Experience management panel
 *
 * Self-contained for sandboxed iframe rendering. Provides CRUD operations,
 * tag filtering, JSON export/import, and clipboard support.
 *
 * All mutations flow through the ExperienceStore provided by the ToolSet's
 * onGetSymbolState. No direct tool calls — the store is a same-realm
 * reference injected via __UAP_APP_HOST__.
 */

import { useState, useCallback, useRef, type ReactElement, type ChangeEvent } from 'react';
import type { ExperienceItem, ExperienceInput, ExperienceStore } from '../agent/types';
import styles from './styles.module.scss';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function collectAllTags(items: readonly ExperienceItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    item.tags?.forEach((t) => seen.add(t));
  }
  return [...seen].sort();
}

// ── AddForm ───────────────────────────────────────────────────────────────────

function AddForm({ onAdd, onCancel }: { onAdd: (input: ExperienceInput) => void; onCancel: () => void }): ReactElement {
  const [trigger, setTrigger] = useState('');
  const [insight, setInsight] = useState('');
  const [evidence, setEvidence] = useState('');
  const [confidence, setConfidence] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');

  function handleSubmit() {
    if (!trigger.trim() || !insight.trim()) return;
    const conf = confidence.trim() ? parseFloat(confidence) : undefined;
    onAdd({
      trigger: trigger.trim(),
      insight: insight.trim(),
      evidence: evidence.trim() || undefined,
      confidence: conf !== undefined && !isNaN(conf) ? conf : undefined,
      tags: parseTags(tagsRaw),
    });
    setTrigger('');
    setInsight('');
    setEvidence('');
    setConfidence('');
    setTagsRaw('');
  }

  return (
    <div className={styles['exp-form']}>
      <textarea
        className={styles['exp-form-textarea']}
        value={trigger}
        onChange={(e) => setTrigger(e.target.value)}
        placeholder="Trigger: activation condition, e.g. REST.status=429; Retry-After in headers"
        rows={2}
        autoFocus
      />
      <textarea
        className={styles['exp-form-textarea']}
        value={insight}
        onChange={(e) => setInsight(e.target.value)}
        placeholder="Insight: rule to apply, e.g. sleep(ms=int(Retry-After)*1000); retry(max=3)"
        rows={2}
      />
      <textarea
        className={styles['exp-form-textarea']}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="Evidence (optional): causal chain, <=2 sentences"
        rows={2}
      />
      <input
        className={styles['exp-form-input']}
        value={confidence}
        onChange={(e) => setConfidence(e.target.value)}
        placeholder="Confidence 0.0-1.0 (optional, default 1.0)"
        type="number"
        min="0"
        max="1"
        step="0.1"
      />
      <input
        className={styles['exp-form-input']}
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        placeholder="Tags: comma-separated, e.g. typescript, api"
      />
      <div className={styles['exp-form-actions']}>
        <button type="button" className={styles['exp-btn-primary']} onClick={handleSubmit} disabled={!trigger.trim() || !insight.trim()}>
          Save
        </button>
        <button type="button" className={styles['exp-btn-ghost']} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── EditForm ──────────────────────────────────────────────────────────────────

function EditForm({ item, onSave, onCancel }: { item: ExperienceItem; onSave: (patch: Partial<ExperienceInput>) => void; onCancel: () => void }): ReactElement {
  const [trigger, setTrigger] = useState(item.trigger);
  const [insight, setInsight] = useState(item.insight);
  const [evidence, setEvidence] = useState(item.evidence ?? '');
  const [confidence, setConfidence] = useState(item.confidence?.toString() ?? '');
  const [tagsRaw, setTagsRaw] = useState(item.tags?.join(', ') ?? '');

  function handleSubmit() {
    if (!trigger.trim() || !insight.trim()) return;
    const conf = confidence.trim() ? parseFloat(confidence) : undefined;
    onSave({
      trigger: trigger.trim(),
      insight: insight.trim(),
      evidence: evidence.trim() || undefined,
      confidence: conf !== undefined && !isNaN(conf) ? conf : undefined,
      tags: parseTags(tagsRaw),
    });
  }

  return (
    <div className={styles['exp-form']}>
      <textarea
        className={styles['exp-form-textarea']}
        value={trigger}
        onChange={(e) => setTrigger(e.target.value)}
        placeholder="Trigger"
        rows={2}
        autoFocus
      />
      <textarea
        className={styles['exp-form-textarea']}
        value={insight}
        onChange={(e) => setInsight(e.target.value)}
        placeholder="Insight"
        rows={2}
      />
      <textarea
        className={styles['exp-form-textarea']}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="Evidence (optional)"
        rows={2}
      />
      <input
        className={styles['exp-form-input']}
        value={confidence}
        onChange={(e) => setConfidence(e.target.value)}
        placeholder="Confidence 0.0-1.0 (optional)"
        type="number"
        min="0"
        max="1"
        step="0.1"
      />
      <input
        className={styles['exp-form-input']}
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        placeholder="Tags: comma-separated"
      />
      <div className={styles['exp-form-actions']}>
        <button type="button" className={styles['exp-btn-primary']} onClick={handleSubmit} disabled={!trigger.trim() || !insight.trim()}>
          Save
        </button>
        <button type="button" className={styles['exp-btn-ghost']} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── ItemRow ───────────────────────────────────────────────────────────────────

function ItemRow({ item, onEdit, onDelete }: { item: ExperienceItem; onEdit: (item: ExperienceItem) => void; onDelete: (id: string) => void }): ReactElement {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={styles['exp-item']}>
      <div className={styles['exp-item-header']}>
        <span className={styles['exp-item-date']}>
          {item.createdAt}
          {item.confidence !== undefined && (
            <span className={styles['exp-item-conf']}>conf={item.confidence.toFixed(2)}</span>
          )}
        </span>
        <div className={styles['exp-item-actions']}>
          {confirmDelete ? (
            <>
              <button type="button" className={styles['exp-btn-danger-sm']} onClick={() => onDelete(item.id)}>Confirm</button>
              <button type="button" className={styles['exp-btn-ghost-sm']} onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className={styles['exp-btn-ghost-sm']} title="Edit" onClick={() => onEdit(item)}>✎</button>
              <button type="button" className={styles['exp-btn-ghost-sm']} title="Delete" onClick={() => setConfirmDelete(true)}>✕</button>
            </>
          )}
        </div>
      </div>
      <p className={`${styles['exp-item-content']} ${styles['exp-item-trigger']}`}>TRIGGER: {item.trigger}</p>
      <p className={styles['exp-item-content']}>{item.insight}</p>
      {item.evidence && (
        <p className={`${styles['exp-item-content']} ${styles['exp-item-evidence']}`}>{item.evidence}</p>
      )}
      {item.tags && item.tags.length > 0 && (
        <div className={styles['exp-item-tags']}>
          {item.tags.map((tag) => (
            <span key={tag} className={styles['exp-tag']}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ExperiencePanel ───────────────────────────────────────────────────────────

export function ExperiencePanel({
  experiences,
  experienceStore,
}: {
  experiences: readonly ExperienceItem[];
  experienceStore: ExperienceStore | undefined;
}): ReactElement {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<ExperienceItem | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allTags = collectAllTags(experiences);

  const filtered = activeTag
    ? experiences.filter((e) => e.tags?.includes(activeTag))
    : experiences;

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1800);
  }, []);

  const handleAdd = useCallback(
    (input: ExperienceInput) => {
      experienceStore?.add(input);
      setShowAddForm(false);
    },
    [experienceStore],
  );

  const handleSaveEdit = useCallback(
    (patch: Partial<ExperienceInput>) => {
      if (!editingItem) return;
      experienceStore?.update(editingItem.id, patch);
      setEditingItem(null);
    },
    [experienceStore, editingItem],
  );

  const handleDelete = useCallback(
    (id: string) => {
      experienceStore?.remove(id);
    },
    [experienceStore],
  );

  const handleExport = useCallback(() => {
    if (!experienceStore) return;
    const json = experienceStore.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `experiences-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [experienceStore]);

  const handleImportFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !experienceStore) return;
      try {
        const text = await file.text();
        const { imported, skipped } = experienceStore.importJSON(text);
        showFeedback(`+${imported} imported${skipped ? `, ${skipped} skipped` : ''}`);
      } catch {
        showFeedback('Invalid JSON');
      }
      e.target.value = '';
    },
    [experienceStore, showFeedback],
  );

  const handleCopy = useCallback(async () => {
    if (!experienceStore) return;
    try {
      await experienceStore.copyToClipboard();
      showFeedback(`${experiences.length} copied`);
    } catch {
      showFeedback('Copy failed');
    }
  }, [experienceStore, experiences.length, showFeedback]);

  const handlePaste = useCallback(async () => {
    if (!experienceStore) return;
    try {
      const { imported, skipped } = await experienceStore.importFromClipboard();
      showFeedback(`+${imported} imported${skipped ? `, ${skipped} skipped` : ''}`);
    } catch {
      showFeedback('Clipboard empty or invalid');
    }
  }, [experienceStore, showFeedback]);

  const canEdit = experienceStore !== undefined;

  return (
    <div className={styles['exp-panel']}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className={styles['hidden']}
        onChange={handleFileChange}
      />

      <div className={styles['exp-toolbar']}>
        <span className={styles['exp-toolbar-title']}>
          Experience
          {experiences.length > 0 && (
            <span className={styles['exp-toolbar-count']}>{experiences.length}</span>
          )}
        </span>
        <div className={styles['exp-toolbar-actions']}>
          {canEdit && (
            <button type="button" className={styles['exp-btn-sm']} onClick={() => setShowAddForm(true)}>
              + Add
            </button>
          )}
          <button type="button" className={styles['exp-btn-sm']} onClick={handleExport} title="Export JSON">
            Export
          </button>
          <button type="button" className={styles['exp-btn-sm']} onClick={handleImportFile} title="Import JSON">
            Import
          </button>
          <button type="button" className={styles['exp-btn-sm']} onClick={handleCopy} title="Copy to clipboard">
            Copy
          </button>
          <button type="button" className={styles['exp-btn-sm']} onClick={handlePaste} title="Paste from clipboard">
            Paste
          </button>
        </div>
      </div>

      {feedback && <div className={styles['exp-feedback']} role="status">{feedback}</div>}

      {showAddForm && (
        <AddForm
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {editingItem && (
        <EditForm
          item={editingItem}
          onSave={handleSaveEdit}
          onCancel={() => setEditingItem(null)}
        />
      )}

      {allTags.length > 0 && (
        <div className={styles['exp-tag-bar']}>
          <button
            type="button"
            className={`${styles['exp-tag-filter']}${activeTag === null ? ` ${styles['exp-tag-filter--active']}` : ''}`}
            onClick={() => setActiveTag(null)}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`${styles['exp-tag-filter']}${activeTag === tag ? ` ${styles['exp-tag-filter--active']}` : ''}`}
              onClick={() => setActiveTag((prev) => (prev === tag ? null : tag))}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className={styles['exp-list']}>
        {filtered.length === 0 && (
          <div className={styles['exp-empty']}>
            {experiences.length === 0
              ? 'No experiences yet. Use experience_add to persist reusable patterns.'
              : 'No experiences match the selected tag filter.'}
          </div>
        )}
        {filtered.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            onEdit={setEditingItem}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
