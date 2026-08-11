/**
 * WorkItemForm
 * ────────────
 * Unified create / edit form for ADO work items.
 *
 * The `mode` discriminant controls:
 *   • create — type selector at top; no children; patch = all non-empty fields
 *   • edit   — fixed type badge; children editor; patch = dirty fields only
 *
 * Bridge namespaces (preserved for backward-compat with agent tools):
 *   create → `wi.createForm.*`
 *   edit   → `dialog.{id}.edit.*` (+ legacy `drawer.{id}.edit.*` for compat)
 */

import React, { useState, useEffect, useRef } from 'react';
import type {
  WorkItem,
  WorkItemTypeDef,
  WorkItemPatch,
  WorkItemFieldDef,
  WorkItemTypeState,
} from '../../api';
import { fetchWorkItemTypeStates, searchWorkItemsByTitle } from '../../api';
import { ParentWorkItemPicker } from './ParentWorkItemPicker';
import type { ParentCandidate } from './ParentWorkItemPicker';
import { WorkItemChildrenEditor } from './WorkItemChildrenEditor';
import type { ChildEntry } from './WorkItemChildrenEditor';
import { coerceFieldValue } from './fieldConfig';
import { ComboSelect } from '../shared/ComboSelect';
import { useWorkItemFormState, emptyFormValues, initialValuesFromItem, type WorkItemFormValues } from './useWorkItemFormState';
import { WorkItemFormFields } from './WorkItemFormFields';
import { uiBridge } from '../../tools/uiBridge';
import styles from './WorkItems.module.scss';

// ── Mode types ────────────────────────────────────────────────────────────────

interface CreateMode {
  mode: 'create';
  defaultType?: string;
  onSave: (type: string, fields: WorkItemPatch & { title: string }) => void;
}

interface EditMode {
  mode: 'edit';
  item: WorkItem;
  onSave: (patch: WorkItemPatch) => void;
}

// ── Props ─────────────────────────────────────────────────────────────────────

type WorkItemFormProps = (CreateMode | EditMode) & {
  /** Semantic dialog ID for multi-dialog support. */
  dialogId?: string;
  collectionUrl: string;
  project: string;
  pat: string;
  types: WorkItemTypeDef[];
  iterations: string[];
  areas: string[];
  members: string[];
  fieldDefs: WorkItemFieldDef[];
  tagOptions?: string[];
  saving: boolean;
  onCancel: () => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function WorkItemForm(props: WorkItemFormProps) {
  const {
    mode, dialogId = 'default', collectionUrl, project, pat, types, iterations, areas, members,
    fieldDefs, tagOptions = [], saving, onCancel,
  } = props;

  // ── Form values (shared hook) ─────────────────────────────────────────────

  const initialValues =
    mode === 'edit' ? initialValuesFromItem(props.item) : { title: '', state: '', ...emptyFormValues, customValues: {} };

  const { values, setters } = useWorkItemFormState(initialValues);

  // ── Create-only state ─────────────────────────────────────────────────────

  const [selectedType, setSelectedType] = useState(
    mode === 'create' ? (props.defaultType ?? types[0]?.name ?? '') : '',
  );

  // Resolved work item type for the current form (create → selectedType, edit → item.type)
  const workItemType = mode === 'create' ? selectedType : props.item.type;

  // ── State options ─────────────────────────────────────────────────────────

  const [stateOptions, setStateOptions] = useState<string[]>(() => {
    if (mode === 'edit') {
      const typeDef = types.find((t) => t.name === props.item.type);
      return typeDef?.states?.map((s) => s.name) ?? [];
    }
    return [];
  });

  // Edit mode: load states for the item's type once.
  useEffect(() => {
    if (mode !== 'edit') return;
    const typeDef = types.find((t) => t.name === props.item.type);
    if (typeDef?.states && typeDef.states.length > 0) {
      setStateOptions(typeDef.states.map((s: WorkItemTypeState) => s.name));
    } else {
      fetchWorkItemTypeStates(collectionUrl, project, pat, props.item.type)
        .then((states) => setStateOptions(states.map((s) => s.name)))
        .catch(() => setStateOptions([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create mode: reload states + reset type-specific fields on type change.
  useEffect(() => {
    if (mode !== 'create' || !selectedType) return;
    setters.resetTypeSpecificFields();
    const typeDef = types.find((t) => t.name === selectedType);
    if (typeDef?.states && typeDef.states.length > 0) {
      const names = typeDef.states.map((s) => s.name);
      setStateOptions(names);
      setters.setState(names[0] ?? '');
    } else {
      fetchWorkItemTypeStates(collectionUrl, project, pat, selectedType)
        .then((states) => {
          const names = states.map((s) => s.name);
          setStateOptions(names);
          setters.setState(names[0] ?? '');
        })
        .catch(() => { setStateOptions([]); setters.setState(''); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  // ── Parent ────────────────────────────────────────────────────────────────

  const [parent, setParent] = useState<ParentCandidate | null>(
    mode === 'edit' && props.item.parentId != null
      ? { id: props.item.parentId, title: props.item.parentTitle ?? '', type: props.item.parentType ?? '' }
      : null,
  );

  // ── Children (edit only) ──────────────────────────────────────────────────

  const [children, setChildren] = useState<ChildEntry[]>(
    mode === 'edit' ? (props.item.children ?? []) : [],
  );
  const [childrenToRemove, setChildrenToRemove] = useState<Array<{ id: number; relationIndex: number }>>([]);
  const [newChildren, setNewChildren] = useState<ParentCandidate[]>([]);

  function handleAddChild(candidate: ParentCandidate) {
    if (
      children.some((c) => c.id === candidate.id) ||
      newChildren.some((c) => c.id === candidate.id)
    ) return;
    setNewChildren((prev) => [...prev, candidate]);
  }

  function handleRemoveExistingChild(child: ChildEntry) {
    setChildren((prev) => prev.filter((c) => c.id !== child.id));
    setChildrenToRemove((prev) => [...prev, { id: child.id, relationIndex: child._relationIndex }]);
  }

  function handleRemoveNewChild(id: number) {
    setNewChildren((prev) => prev.filter((c) => c.id !== id));
  }

  // ── Bridge registration ───────────────────────────────────────────────────

  // Use dialogId in the namespace so multiple forms can coexist
  const ns = mode === 'create' ? `wi.createForm.${dialogId}` : `dialog.${dialogId}.edit`;
  // Also register under old `drawer.{id}.edit` key for backward compat
  const legacyNs = mode === 'create' ? null : `drawer.${dialogId}.edit`;

  const stateRef = useRef({ selectedType, stateOptions, values, parent, children, newChildren });
  stateRef.current = { selectedType, stateOptions, values, parent, children, newChildren };

  useEffect(() => {
    // Register under both new (dialog) and old (drawer) keys for backward compat
    const prefixes = legacyNs ? [ns, legacyNs] : [ns];
    for (const p of prefixes) {
      uiBridge.register(`${p}.getState`, () => stateRef.current);

      if (mode === 'create') {
        uiBridge.register(`${p}.setType`, setSelectedType);
      }

      uiBridge.register(`${p}.setTitle`,              setters.setTitle);
      uiBridge.register(`${p}.setState`,              setters.setState);
      uiBridge.register(`${p}.setAssignedTo`,         setters.setAssignedTo);
      uiBridge.register(`${p}.setPriority`,           setters.setPriority);
      uiBridge.register(`${p}.setIterationPath`,      setters.setIterationPath);
      uiBridge.register(`${p}.setAreaPath`,           setters.setAreaPath);
      uiBridge.register(`${p}.setTags`,               setters.setTags);
      uiBridge.register(`${p}.setEffort`,             setters.setEffort);
      uiBridge.register(`${p}.setOriginalEstimate`,   setters.setOriginalEstimate);
      uiBridge.register(`${p}.setRemainingWork`,      setters.setRemainingWork);
      uiBridge.register(`${p}.setCompletedWork`,      setters.setCompletedWork);
      uiBridge.register(`${p}.setStoryPoints`,        setters.setStoryPoints);
      uiBridge.register(`${p}.setBusinessValue`,      setters.setBusinessValue);
      uiBridge.register(`${p}.setSeverity`,           setters.setSeverity);
      uiBridge.register(`${p}.setActivity`,           setters.setActivity);
      uiBridge.register(`${p}.setValueArea`,          setters.setValueArea);
      uiBridge.register(`${p}.setStartDate`,          setters.setStartDate);
      uiBridge.register(`${p}.setFinishDate`,         setters.setFinishDate);
      uiBridge.register(`${p}.setTargetDate`,         setters.setTargetDate);
      uiBridge.register(`${p}.setDescription`,        setters.setDescription);
      uiBridge.register(`${p}.setAcceptanceCriteria`, setters.setAcceptanceCriteria);
      uiBridge.register(`${p}.setCustomField`,        setters.setCustomValue);
      uiBridge.register(`${p}.setParent`,             setParent);
      uiBridge.register(`${p}.searchParent`, async (query: string) =>
        searchWorkItemsByTitle(collectionUrl, project, pat, query, 15));

      if (mode === 'edit') {
        uiBridge.register(`${p}.searchChild`, async (query: string) =>
          searchWorkItemsByTitle(collectionUrl, project, pat, query, 15));
        uiBridge.register(`${p}.addChild`, handleAddChild);
        uiBridge.register(`${p}.removeExistingChild`, (childId: number) => {
          const child = stateRef.current.children.find((c) => c.id === childId);
          if (child) handleRemoveExistingChild(child);
        });
        uiBridge.register(`${p}.removeNewChild`, handleRemoveNewChild);
      }

      // Batch field setter
      uiBridge.register(`${p}.setFields`, (fields: Partial<WorkItemFormValues>) => {
        if (fields.title !== undefined) setters.setTitle(fields.title);
        if (fields.state !== undefined) setters.setState(fields.state);
        if (fields.assignedTo !== undefined) setters.setAssignedTo(fields.assignedTo);
        if (fields.priority !== undefined) setters.setPriority(fields.priority);
        if (fields.iterationPath !== undefined) setters.setIterationPath(fields.iterationPath);
        if (fields.areaPath !== undefined) setters.setAreaPath(fields.areaPath);
        if (fields.tags !== undefined) setters.setTags(fields.tags);
        if (fields.effort !== undefined) setters.setEffort(fields.effort);
        if (fields.originalEstimate !== undefined) setters.setOriginalEstimate(fields.originalEstimate);
        if (fields.remainingWork !== undefined) setters.setRemainingWork(fields.remainingWork);
        if (fields.completedWork !== undefined) setters.setCompletedWork(fields.completedWork);
        if (fields.storyPoints !== undefined) setters.setStoryPoints(fields.storyPoints);
        if (fields.businessValue !== undefined) setters.setBusinessValue(fields.businessValue);
        if (fields.severity !== undefined) setters.setSeverity(fields.severity);
        if (fields.activity !== undefined) setters.setActivity(fields.activity);
        if (fields.valueArea !== undefined) setters.setValueArea(fields.valueArea);
        if (fields.startDate !== undefined) setters.setStartDate(fields.startDate);
        if (fields.finishDate !== undefined) setters.setFinishDate(fields.finishDate);
        if (fields.targetDate !== undefined) setters.setTargetDate(fields.targetDate);
        if (fields.description !== undefined) setters.setDescription(fields.description);
        if (fields.acceptanceCriteria !== undefined) setters.setAcceptanceCriteria(fields.acceptanceCriteria);
      });

      uiBridge.register(`${p}.submit`, () => {
        const attr = mode === 'create' ? `create:${dialogId}` : `edit:${dialogId}`;
        document.querySelector<HTMLFormElement>(`[data-wi-form="${attr}"]`)?.requestSubmit();
      });
    }
    // Cancel: register under both prefixes
    for (const p of prefixes) {
      uiBridge.register(`${p}.cancel`, onCancel);
    }

    return () => {
      const allPrefixes = prefixes;
      const keys = allPrefixes.flatMap((p) => [
        `${p}.getState`,
        ...(mode === 'create' ? [`${p}.setType`] : []),
        `${p}.setTitle`,          `${p}.setState`,
        `${p}.setAssignedTo`,     `${p}.setPriority`,
        `${p}.setIterationPath`,  `${p}.setAreaPath`,       `${p}.setTags`,
        `${p}.setEffort`,         `${p}.setOriginalEstimate`,
        `${p}.setRemainingWork`,  `${p}.setCompletedWork`,
        `${p}.setStoryPoints`,    `${p}.setBusinessValue`,
        `${p}.setSeverity`,       `${p}.setActivity`,       `${p}.setValueArea`,
        `${p}.setStartDate`,      `${p}.setFinishDate`,     `${p}.setTargetDate`,
        `${p}.setDescription`,    `${p}.setAcceptanceCriteria`,
        `${p}.setCustomField`,    `${p}.setParent`,         `${p}.searchParent`,
        `${p}.setFields`,
        ...(mode === 'edit' ? [
          `${p}.searchChild`, `${p}.addChild`, `${p}.removeExistingChild`, `${p}.removeNewChild`,
        ] : []),
        `${p}.submit`, `${p}.cancel`,
      ]);
      keys.forEach((k) => uiBridge.unregister(k));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogId]);

  // ── Submit handlers ───────────────────────────────────────────────────────

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode !== 'create') return;
    const v = values;
    const fields: WorkItemPatch & { title: string } = { title: v.title };

    if (v.state)         fields.state         = v.state;
    if (v.assignedTo)    fields.assignedTo    = v.assignedTo;
    if (v.priority)      fields.priority      = Number(v.priority);
    if (v.iterationPath) fields.iterationPath = v.iterationPath;
    if (v.areaPath)      fields.areaPath      = v.areaPath;
    if (v.tags)          fields.tags          = v.tags;
    if (v.effort)             fields.effort             = Number(v.effort);
    if (v.remainingWork)      fields.remainingWork      = Number(v.remainingWork);
    if (v.completedWork)      fields.completedWork      = Number(v.completedWork);
    if (v.originalEstimate)   fields.originalEstimate   = Number(v.originalEstimate);
    if (v.storyPoints)        fields.storyPoints        = Number(v.storyPoints);
    if (v.businessValue)      fields.businessValue      = Number(v.businessValue);
    if (v.severity)    fields.severity    = v.severity;
    if (v.activity)    fields.activity    = v.activity;
    if (v.valueArea)   fields.valueArea   = v.valueArea;
    if (v.startDate)   fields.startDate   = v.startDate;
    if (v.finishDate)  fields.finishDate  = v.finishDate;
    if (v.targetDate)  fields.targetDate  = v.targetDate;
    if (v.description)        fields.description        = v.description;
    if (v.acceptanceCriteria) fields.acceptanceCriteria = v.acceptanceCriteria;
    if (parent)               fields.parentId           = parent.id;

    const customEntries = Object.entries(v.customValues).filter(([, val]) => val.trim() !== '');
    if (customEntries.length > 0) {
      fields.customFields = Object.fromEntries(
        customEntries.map(([ref, val]) => {
          const def = fieldDefs.find((f) => f.referenceName === ref);
          return [ref, def ? coerceFieldValue(def, val) : val];
        }),
      );
    }

    props.onSave(selectedType, fields);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode !== 'edit') return;
    const v = values;
    const item = props.item;
    const patch: WorkItemPatch = {};

    if (v.title         !== item.title)                   patch.title         = v.title;
    if (v.state         !== item.state)                   patch.state         = v.state;
    if (v.assignedTo    !== (item.assignedTo  ?? ''))     patch.assignedTo    = v.assignedTo    || undefined;
    if (v.iterationPath !== (item.iterationPath ?? ''))   patch.iterationPath = v.iterationPath || undefined;
    if (v.areaPath      !== (item.areaPath ?? ''))        patch.areaPath      = v.areaPath      || undefined;
    if (v.tags          !== (item.tags ?? ''))            patch.tags          = v.tags;
    if (v.priority      !== (item.priority != null ? String(item.priority) : ''))
      patch.priority = v.priority ? Number(v.priority) : undefined;

    const numericDiff = (val: string, orig: number | undefined) =>
      val !== (orig != null ? String(orig) : '') ? (val ? Number(val) : undefined) : undefined;

    const effort           = numericDiff(v.effort,           item.effort);
    const originalEstimate = numericDiff(v.originalEstimate, item.originalEstimate);
    const remainingWork    = numericDiff(v.remainingWork,    item.remainingWork);
    const completedWork    = numericDiff(v.completedWork,    item.completedWork);
    const storyPoints      = numericDiff(v.storyPoints,      item.storyPoints);
    const businessValue    = numericDiff(v.businessValue,    item.businessValue);
    if (effort           !== undefined) patch.effort           = effort;
    if (originalEstimate !== undefined) patch.originalEstimate = originalEstimate;
    if (remainingWork    !== undefined) patch.remainingWork    = remainingWork;
    if (completedWork    !== undefined) patch.completedWork    = completedWork;
    if (storyPoints      !== undefined) patch.storyPoints      = storyPoints;
    if (businessValue    !== undefined) patch.businessValue    = businessValue;

    if (v.startDate  !== (item.startDate?.slice(0, 10)  ?? '')) patch.startDate  = v.startDate  || undefined;
    if (v.finishDate !== (item.finishDate?.slice(0, 10) ?? '')) patch.finishDate = v.finishDate || undefined;
    if (v.targetDate !== (item.targetDate?.slice(0, 10) ?? '')) patch.targetDate = v.targetDate || undefined;

    if (v.severity  !== (item.severity  ?? '')) patch.severity  = v.severity  || undefined;
    if (v.activity  !== (item.activity  ?? '')) patch.activity  = v.activity  || undefined;
    if (v.valueArea !== (item.valueArea ?? '')) patch.valueArea = v.valueArea || undefined;

    if (v.description        !== (item.description        ?? '')) patch.description        = v.description;
    if (v.acceptanceCriteria !== (item.acceptanceCriteria ?? '')) patch.acceptanceCriteria = v.acceptanceCriteria;

    const newParentId = parent?.id ?? null;
    const oldParentId = item.parentId ?? null;
    if (newParentId !== oldParentId) {
      patch.parentId = newParentId;
      if (oldParentId !== null && item._parentRelationIndex !== undefined)
        patch._currentParentRelationIndex = item._parentRelationIndex;
    }

    const customPatch: Record<string, unknown> = {};
    for (const f of fieldDefs.filter((fd) => fd.isCustom && !fd.readOnly)) {
      const newVal  = v.customValues[f.referenceName] ?? '';
      const origVal = item.customFields?.[f.referenceName] != null
        ? String(item.customFields[f.referenceName]) : '';
      if (newVal !== origVal)
        customPatch[f.referenceName] = newVal === '' ? null : coerceFieldValue(f, newVal);
    }
    if (Object.keys(customPatch).length > 0) patch.customFields = customPatch;

    if (newChildren.length      > 0) patch.childrenToAdd    = newChildren.map((c) => c.id);
    if (childrenToRemove.length > 0) patch.childrenToRemove = childrenToRemove;

    if (Object.keys(patch).length === 0) { onCancel(); return; }
    props.onSave(patch);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isCreate = mode === 'create';
  const formAttr = {
    'data-wi-form': isCreate ? `create:${dialogId}` : `edit:${dialogId}`,
  };
  const isSubmitDisabled = saving || !values.title.trim() || (isCreate && !selectedType);

  return (
    <form
      onSubmit={isCreate ? handleCreateSubmit : handleEditSubmit}
      className={styles.editForm}
      {...formAttr}
    >
      {/* ── Type selector (create only) ── */}
      {isCreate && (
        <div className={styles.editField}>
          <label className={styles.editLabel}>工作项类型 *</label>
          <ComboSelect
            value={selectedType}
            onChange={setSelectedType}
            options={types.map((t) => t.name)}
            placeholder="选择工作项类型…"
            disabled={saving}
            allowFreeText={false}
          />
        </div>
      )}

      {/* ── Title ── */}
      <div className={styles.editField}>
        <label className={styles.editLabel}>标题 *</label>
        <input
          className={styles.editInput}
          type="text"
          value={values.title}
          onChange={(e) => setters.setTitle(e.target.value)}
          required
          autoFocus={isCreate}
        />
      </div>

      {/* ── Parent picker ── */}
      <div className={styles.editField}>
        <label className={styles.editLabel}>父工作项</label>
        <ParentWorkItemPicker
          collectionUrl={collectionUrl}
          project={project}
          pat={pat}
          value={parent}
          onChange={setParent}
          disabled={saving}
        />
      </div>

      {/* ── Shared field sections ── */}
      <WorkItemFormFields
        values={values}
        setters={setters}
        stateOptions={stateOptions}
        iterations={iterations}
        areas={areas}
        members={members}
        fieldDefs={fieldDefs}
        tagOptions={tagOptions}
        workItemType={workItemType}
        disabled={saving}
        collectionUrl={collectionUrl}
        project={project}
        pat={pat}
      />

      {/* ── Children editor (edit only) ── */}
      {mode === 'edit' && (
        <WorkItemChildrenEditor
          collectionUrl={collectionUrl}
          project={project}
          pat={pat}
          children={children}
          newChildren={newChildren}
          disabled={saving}
          onAdd={handleAddChild}
          onRemoveExisting={handleRemoveExistingChild}
          onRemoveNew={handleRemoveNewChild}
        />
      )}

      {/* ── Actions ── */}
      <div className={styles.editActions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button type="submit" className={styles.saveBtn} disabled={isSubmitDisabled}>
          {saving ? (isCreate ? '创建中...' : '保存中...') : (isCreate ? '创建' : '保存')}
        </button>
      </div>
    </form>
  );
}
