/**
 * WorkItemFormFields
 * ──────────────────
 * Presentational component that renders the shared field sections used by
 * both WorkItemCreateForm and WorkItemEditForm:
 *
 *   • Status / Priority row
 *   • Assigned-to
 *   • Iteration / Area paths
 *   • Scheduling group  (estimates, remaining/completed, story points, dates)
 *   • Metadata group    (severity, activity, value area)
 *   • Tags
 *   • Rich-text         (description, acceptance criteria)
 *   • Custom fields
 *
 * Everything context-specific (type selector, title, parent picker, children,
 * action buttons) lives in the form containers — not here.
 */

import React from 'react';
import type { WorkItemFieldDef } from '../../api';
import { SEVERITY_OPTIONS, ACTIVITY_OPTIONS, VALUE_AREA_OPTIONS } from './fieldConfig';
import { WorkItemFieldInput } from './WorkItemFieldInput';
import { ComboSelect } from '../shared/ComboSelect';
import { TagInput } from '../shared/TagInput';
import { RichTextEditor } from '../shared/RichTextEditor';
import type { WorkItemFormValues, WorkItemFormSetters } from './useWorkItemFormState';
import styles from './WorkItems.module.scss';

interface WorkItemFormFieldsProps {
  values: WorkItemFormValues;
  setters: WorkItemFormSetters;
  /** Options for the State combobox. */
  stateOptions: string[];
  iterations: string[];
  areas: string[];
  members: string[];
  fieldDefs: WorkItemFieldDef[];
  tagOptions: string[];
  /** Current work item type — used to scope field option queries. */
  workItemType: string;
  /** Forwarded to all inputs. */
  disabled: boolean;
  /** For ADO field option queries. */
  collectionUrl: string;
  project: string;
  pat: string;
}

export function WorkItemFormFields({
  values,
  setters,
  stateOptions,
  iterations,
  areas,
  members,
  fieldDefs,
  tagOptions,
  workItemType,
  disabled,
  collectionUrl,
  project,
  pat,
}: WorkItemFormFieldsProps) {
  const editableCustomFields = fieldDefs.filter((f) => f.isCustom && !f.readOnly);

  return (
    <>
      {/* ── Status / Priority ── */}
      <div className={styles.editRow}>
        <div className={styles.editField}>
          <label className={styles.editLabel}>状态</label>
          <ComboSelect
            value={values.state}
            onChange={setters.setState}
            options={stateOptions}
            placeholder={stateOptions.length === 0 ? '加载中…' : '选择状态…'}
            disabled={disabled}
            allowFreeText={false}
          />
        </div>
        <div className={styles.editField}>
          <label className={styles.editLabel}>优先级</label>
          <ComboSelect
            value={values.priority}
            onChange={setters.setPriority}
            options={[
              { value: '1', label: '1 - 紧急' },
              { value: '2', label: '2 - 高' },
              { value: '3', label: '3 - 中' },
              { value: '4', label: '4 - 低' },
            ]}
            placeholder="—"
            disabled={disabled}
            clearable
          />
        </div>
      </div>

      {/* ── Assigned-to ── */}
      <div className={styles.editField}>
        <label className={styles.editLabel}>负责人</label>
        <ComboSelect
          value={values.assignedTo}
          onChange={setters.setAssignedTo}
          options={members}
          placeholder="未分配"
          disabled={disabled}
          clearable
        />
      </div>

      {/* ── Paths ── */}
      {iterations.length > 0 && (
        <div className={styles.editField}>
          <label className={styles.editLabel}>迭代路径</label>
          <ComboSelect
            value={values.iterationPath}
            onChange={setters.setIterationPath}
            options={iterations}
            placeholder="—"
            disabled={disabled}
            clearable
          />
        </div>
      )}
      {areas.length > 0 && (
        <div className={styles.editField}>
          <label className={styles.editLabel}>区域路径</label>
          <ComboSelect
            value={values.areaPath}
            onChange={setters.setAreaPath}
            options={areas}
            placeholder="—"
            disabled={disabled}
            clearable
          />
        </div>
      )}

      {/* ── Scheduling ── */}
      <div className={styles.editRow}>
        <div className={styles.editField}>
          <label className={styles.editLabel}>原始估算</label>
          <input className={styles.editInput} type="number" min="0" step="0.5"
            value={values.originalEstimate}
            onChange={(e) => setters.setOriginalEstimate(e.target.value)} />
        </div>
        <div className={styles.editField}>
          <label className={styles.editLabel}>工作量</label>
          <input className={styles.editInput} type="number" min="0" step="0.5"
            value={values.effort}
            onChange={(e) => setters.setEffort(e.target.value)} />
        </div>
      </div>

      <div className={styles.editRow}>
        <div className={styles.editField}>
          <label className={styles.editLabel}>剩余工时</label>
          <input className={styles.editInput} type="number" min="0" step="0.5"
            value={values.remainingWork}
            onChange={(e) => setters.setRemainingWork(e.target.value)} />
        </div>
        <div className={styles.editField}>
          <label className={styles.editLabel}>已完成工时</label>
          <input className={styles.editInput} type="number" min="0" step="0.5"
            value={values.completedWork}
            onChange={(e) => setters.setCompletedWork(e.target.value)} />
        </div>
      </div>

      <div className={styles.editRow}>
        <div className={styles.editField}>
          <label className={styles.editLabel}>故事点</label>
          <input className={styles.editInput} type="number" min="0" step="0.5"
            value={values.storyPoints}
            onChange={(e) => setters.setStoryPoints(e.target.value)} />
        </div>
        <div className={styles.editField}>
          <label className={styles.editLabel}>业务价值</label>
          <input className={styles.editInput} type="number" min="0" step="1"
            value={values.businessValue}
            onChange={(e) => setters.setBusinessValue(e.target.value)} />
        </div>
      </div>

      <div className={styles.editRow}>
        <div className={styles.editField}>
          <label className={styles.editLabel}>开始日期</label>
          <input className={styles.editInput} type="date"
            value={values.startDate}
            onChange={(e) => setters.setStartDate(e.target.value)} />
        </div>
        <div className={styles.editField}>
          <label className={styles.editLabel}>完成日期</label>
          <input className={styles.editInput} type="date"
            value={values.finishDate}
            onChange={(e) => setters.setFinishDate(e.target.value)} />
        </div>
      </div>

      <div className={styles.editField}>
        <label className={styles.editLabel}>目标日期</label>
        <input className={styles.editInput} type="date"
          value={values.targetDate}
          onChange={(e) => setters.setTargetDate(e.target.value)} />
      </div>

      {/* ── Metadata ── */}
      <div className={styles.editRow}>
        <div className={styles.editField}>
          <label className={styles.editLabel}>严重程度</label>
          <ComboSelect value={values.severity} onChange={setters.setSeverity}
            options={[...SEVERITY_OPTIONS]} placeholder="—" disabled={disabled} clearable />
        </div>
        <div className={styles.editField}>
          <label className={styles.editLabel}>活动类型</label>
          <ComboSelect value={values.activity} onChange={setters.setActivity}
            options={[...ACTIVITY_OPTIONS]} placeholder="—" disabled={disabled} clearable />
        </div>
      </div>

      <div className={styles.editField}>
        <label className={styles.editLabel}>价值域</label>
        <ComboSelect value={values.valueArea} onChange={setters.setValueArea}
          options={[...VALUE_AREA_OPTIONS]} placeholder="—" disabled={disabled} clearable />
      </div>

      {/* ── Tags ── */}
      <div className={styles.editField}>
        <label className={styles.editLabel}>标签</label>
        <TagInput
          value={values.tags}
          onChange={setters.setTags}
          suggestions={tagOptions}
          disabled={disabled}
          placeholder="添加标签…"
        />
      </div>

      {/* ── Rich-text ── */}
      <div className={styles.editField}>
        <label className={styles.editLabel}>描述</label>
        <RichTextEditor
          value={values.description}
          onChange={setters.setDescription}
          disabled={disabled}
          placeholder="工作项描述（支持富文本格式）..."
        />
      </div>

      <div className={styles.editField}>
        <label className={styles.editLabel}>验收标准</label>
        <RichTextEditor
          value={values.acceptanceCriteria}
          onChange={setters.setAcceptanceCriteria}
          disabled={disabled}
          placeholder="验收标准（支持富文本格式）..."
        />
      </div>

      {/* ── Custom fields ── */}
      {editableCustomFields.length > 0 && (
        <div className={styles.customFieldsSection}>
          <div className={styles.customFieldsHeading}>自定义字段</div>
          {editableCustomFields.map((f) => (
            <div key={f.referenceName} className={styles.editField}>
              <label className={styles.editLabel}>{f.name}</label>
              <WorkItemFieldInput
                field={f}
                value={values.customValues[f.referenceName] ?? ''}
                onChange={(v) => setters.setCustomValue(f.referenceName, v)}
                disabled={disabled}
                collectionUrl={collectionUrl}
                project={project}
                pat={pat}
                workItemType={workItemType}
                members={members}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
