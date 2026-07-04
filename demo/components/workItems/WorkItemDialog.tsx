/**
 * WorkItemDialog — Unified dialog for view/edit/create work items.
 *
 * Two modes:
 *   mode="view"  → load item by itemId, show detail/edit/comments/history/attachments tabs
 *   mode="create"→ directly show WorkItemForm in create mode
 *
 * Bridge keys (legacy compat):
 *   view mode   → `drawer.{dialogId}.*`   (backward compat with agent tools)
 *   create mode → `wi.createForm.{dialogId}.*` (unchanged)
 *   Both also register under `dialog.{dialogId}.*` (new canonical key).
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  fetchSingleWorkItemFull,
  fetchWorkItemComments,
  fetchWorkItemUpdates,
  fetchWorkItemFields,
  addWorkItemComment,
  updateWorkItem,
  deleteWorkItem,
  uploadAttachment,
  addAttachmentToWorkItem,
  createWorkItem,
} from '../../api';
import type {
  WorkItem,
  WorkItemTypeDef,
  WorkItemFieldDef,
  WorkItemComment,
  WorkItemUpdate,
  WorkItemAttachment,
  WorkItemPatch,
} from '../../api';
import { Spinner } from '../shared/Spinner';
import { WorkItemDetail } from './WorkItemDetail';
import { WorkItemComments } from './WorkItemComments';
import { WorkItemHistory } from './WorkItemHistory';
import { WorkItemAttachmentTab } from './WorkItemAttachmentTab';
import { WorkItemForm } from './WorkItemForm';
import { uiBridge } from '../../tools/uiBridge';
import styles from './WorkItems.module.scss';

// ── Types ────────────────────────────────────────────────────────────────────

type ViewTab = 'detail' | 'edit' | 'history' | 'comments' | 'attachments';

const TAB_LABELS: Record<ViewTab, string> = {
  detail: '详情', edit: '编辑', comments: '评论', history: '历史', attachments: '附件',
};

interface SharedProps {
  /** 'view' = load by itemId (detail/edit/comments/history/attachments tabs). 'create' = new form. */
  mode: 'view' | 'create';
  dialogId: string;
  collectionUrl: string;
  project: string;
  pat: string;
  types: WorkItemTypeDef[];
  iterations: string[];
  areas: string[];
  members: string[];
  fieldDefs: WorkItemFieldDef[];
  tagOptions: string[];
  /** Called when the dialog is dismissed. */
  onClose: () => void;
  /** Called after a successful save/create to refresh the parent list. */
  onSaved: () => void;
}

// View-mode specifics
interface ViewProps {
  mode: 'view';
  itemId: number;
  /** When true, start on the edit tab instead of detail. */
  startEdit?: boolean;
}

// Create-mode specifics
interface CreateProps {
  mode: 'create';
  defaultType?: string;
}

type Props = SharedProps & (ViewProps | CreateProps);

// ── Component ────────────────────────────────────────────────────────────────

export function WorkItemDialog(props: Props) {
  const {
    mode, dialogId, collectionUrl, project, pat,
    types, iterations, areas, members, fieldDefs, tagOptions,
    onClose, onSaved,
  } = props;
  const isView = mode === 'view';

  // ── View-mode state ────────────────────────────────────────────────────────
  const [tab, setTab] = useState<ViewTab>(isView && props.startEdit ? 'edit' : 'detail');
  const [item, setItem] = useState<WorkItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Edit state (view mode) ──────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // ── Comments (view mode) ────────────────────────────────────────────────────
  const [comments, setComments] = useState<WorkItemComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // ── History (view mode) ─────────────────────────────────────────────────────
  const [updates, setUpdates] = useState<WorkItemUpdate[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(false);

  // ── Attachments (view mode) ─────────────────────────────────────────────────
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentResult, setAttachmentResult] = useState<WorkItemAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // ── Create-mode state ──────────────────────────────────────────────────────
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Load item (view mode) ──────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'view') return;
    setLoading(true);
    setError(null);
    setTab(props.startEdit ? 'edit' : 'detail');
    Promise.all([
      fetchSingleWorkItemFull(collectionUrl, pat, props.itemId),
      fetchWorkItemFields(collectionUrl, project, pat),
    ])
      .then(([wi, defs]) => { setItem(wi); setFieldDefsLoc(defs); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionUrl, project, pat, isView ? props.itemId : undefined]);

  const [fieldDefsLoc, setFieldDefsLoc] = useState<WorkItemFieldDef[]>(fieldDefs);

  // ── Lazy load comments/history ─────────────────────────────────────────────
  const itemId = isView ? props.itemId : 0;
  useEffect(() => {
    if (!isView || !item) return;
    if (tab === 'comments' && comments.length === 0) {
      setCommentsLoading(true);
      fetchWorkItemComments(collectionUrl, project, pat, itemId, 50)
        .then(setComments).catch(console.error).finally(() => setCommentsLoading(false));
    }
    if (tab === 'history' && updates.length === 0) {
      setUpdatesLoading(true);
      fetchWorkItemUpdates(collectionUrl, project, pat, itemId, 50)
        .then((u) => setUpdates([...u].reverse())).catch(console.error).finally(() => setUpdatesLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── Save handler (view mode: edit tab) ─────────────────────────────────────
  async function handleSave(patch: Parameters<typeof updateWorkItem>[4]) {
    if (!item) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateWorkItem(collectionUrl, project, pat, item.id, patch);
      setItem(await fetchSingleWorkItemFull(collectionUrl, pat, itemId));
      setTab('detail');
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Delete handler (view mode) ─────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setSaveError(null);
    try {
      await deleteWorkItem(collectionUrl, project, pat, itemId);
      onSaved();
      onClose();
    } catch (e) {
      setSaveError('删除失败：' + (e instanceof Error ? e.message : String(e)));
      setDeleteConfirm(false);
    }
  }

  // ── Comment handler (view mode) ────────────────────────────────────────────
  async function handleAddComment() {
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const c = await addWorkItemComment(collectionUrl, project, pat, itemId, commentText.trim());
      setComments((prev) => [c, ...prev]);
      setCommentText('');
    } catch (e) {
      setSaveError('评论失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSubmittingComment(false);
    }
  }

  // ── Attachment handler (view mode) ─────────────────────────────────────────
  async function handleUploadAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !item) return;
    setUploadingAttachment(true);
    setAttachmentError(null);
    setAttachmentResult(null);
    try {
      const uploaded = await uploadAttachment(collectionUrl, pat, file.name, await file.arrayBuffer());
      await addAttachmentToWorkItem(collectionUrl, project, pat, item.id, uploaded.url, file.name);
      setAttachmentResult(uploaded);
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingAttachment(false);
      e.target.value = '';
    }
  }

  // ── Create handler (create mode) ───────────────────────────────────────────
  async function handleCreate(type: string, fields: WorkItemPatch & { title: string }) {
    setCreateSaving(true);
    setCreateError(null);
    try {
      await createWorkItem(collectionUrl, project, pat, type, fields);
      onSaved();
      onClose();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateSaving(false);
    }
  }

  // ── Bridge registration ────────────────────────────────────────────────────
  const stateRef = useRef({
    tab, item, loading, error, saving, saveError, deleteConfirm,
    comments, commentsLoading, commentText, submittingComment,
    updates, updatesLoading,
    createSaving, createError,
  });
  stateRef.current = {
    tab, item, loading, error, saving, saveError, deleteConfirm,
    comments, commentsLoading, commentText, submittingComment,
    updates, updatesLoading,
    createSaving, createError,
  };

  // Register under both old (drawer) and new (dialog) bridge keys for compat
  useEffect(() => {
    const keys = [`dialog.${dialogId}`, `drawer.${dialogId}`];
    for (const prefix of keys) {
      uiBridge.register(`${prefix}.getState`, () => stateRef.current);
      uiBridge.register(`${prefix}.setTab`, setTab);
      uiBridge.register(`${prefix}.setCommentText`, setCommentText);
      uiBridge.register(`${prefix}.submitComment`, () => handleAddComment());
      uiBridge.register(`${prefix}.initiateDelete`, () => handleDelete());
      uiBridge.register(`${prefix}.cancelDelete`, () => setDeleteConfirm(false));
    }
    return () => {
      for (const prefix of keys) {
        uiBridge.unregister(`${prefix}.getState`);
        uiBridge.unregister(`${prefix}.setTab`);
        uiBridge.unregister(`${prefix}.setCommentText`);
        uiBridge.unregister(`${prefix}.submitComment`);
        uiBridge.unregister(`${prefix}.initiateDelete`);
        uiBridge.unregister(`${prefix}.cancelDelete`);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogId]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const typeColor = types.find((t) => t.name === item?.type)?.color;

  // ── Header: view mode ──────────────────────────────────────────────────────
  function renderHeader() {
    return (
      <div className={styles.dialogHeader}>
        <div className={styles.dialogMeta}>
          {item && (
            <>
              <span
                className={styles.dialogTypeChip}
                style={typeColor ? { background: `#${typeColor}22`, color: `#${typeColor}` } : undefined}
              >
                {item.type}
              </span>
              <span className={styles.dialogItemId}>#{item.id}</span>
              <span className={styles.dialogIdBadge}>{dialogId}</span>
            </>
          )}
        </div>
        <div className={styles.dialogActions}>
          {item && (
            <button
              className={`${styles.dialogActionBtn} ${styles.deleteBtn} ${deleteConfirm ? styles.deleteConfirm : ''}`}
              onClick={handleDelete}
              title={deleteConfirm ? '确认删除' : '删除工作项'}
            >
              {deleteConfirm ? '确认删除？' : '🗑'}
            </button>
          )}
          {deleteConfirm && (
            <button className={styles.dialogActionBtn} onClick={() => setDeleteConfirm(false)}>取消</button>
          )}
          <button className={styles.dialogCloseBtn} onClick={onClose} title="关闭">✕</button>
        </div>
      </div>
    );
  }

  // ── Tab bar: view mode ─────────────────────────────────────────────────────
  function renderTabs() {
    return (
      <div className={styles.dialogTabs}>
        {(Object.keys(TAB_LABELS) as ViewTab[]).map((t) => (
          <button
            key={t}
            className={`${styles.dialogTab} ${tab === t ? styles.dialogTabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
    );
  }

  // ── Content area ───────────────────────────────────────────────────────────
  function renderContent() {
    if (isView) {
      if (loading) return <Spinner label="加载中..." />;
      if (error) return <div className={styles.errorBanner}>&#9888; {error}</div>;
      if (!item) return null;
      return (
        <>
          {tab === 'detail' && <WorkItemDetail item={item} fieldDefs={fieldDefsLoc} />}
          {tab === 'edit' && (
            <WorkItemForm
              mode="edit"
              dialogId={dialogId}
              collectionUrl={collectionUrl} project={project} pat={pat}
              item={item} types={types} iterations={iterations}
              areas={areas} members={members} fieldDefs={fieldDefsLoc}
              tagOptions={tagOptions}
              saving={saving} onSave={handleSave} onCancel={() => setTab('detail')}
            />
          )}
          {tab === 'comments' && (
            <WorkItemComments
              comments={comments} loading={commentsLoading}
              commentText={commentText} submitting={submittingComment}
              onTextChange={setCommentText} onSubmit={handleAddComment}
            />
          )}
          {tab === 'history' && <WorkItemHistory updates={updates} loading={updatesLoading} />}
          {tab === 'attachments' && (
            <WorkItemAttachmentTab
              uploading={uploadingAttachment} result={attachmentResult}
              error={attachmentError} onFileChange={handleUploadAttachment}
            />
          )}
        </>
      );
    }

    // Create mode
    return (
      <WorkItemForm
        mode="create"
        defaultType={mode === 'create' ? props.defaultType : undefined}
        dialogId={dialogId}
        collectionUrl={collectionUrl} project={project} pat={pat}
        types={types} iterations={iterations} areas={areas}
        members={members} fieldDefs={fieldDefs} tagOptions={tagOptions}
        saving={createSaving} onSave={handleCreate} onCancel={onClose}
      />
    );
  }

  return (
    <div className={styles.dialog}>
      {isView && renderHeader()}
      {isView && item && <h2 className={styles.dialogTitle}>{item.title}</h2>}
      {isView && renderTabs()}
      <div className={styles.dialogContent}>
        {isView && saveError && (
          <div className={styles.errorBanner} role="alert">
            <span>⚠</span> {saveError}
          </div>
        )}
        {!isView && createError && (
          <div className={styles.errorBanner} role="alert">
            <span>⚠</span> {createError}
          </div>
        )}
        {renderContent()}
      </div>
    </div>
  );
}
