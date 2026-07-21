import React from 'react';
import type { WorkItemTypeDef } from '../../api';
import { ComboSelect } from '../shared/ComboSelect';
import styles from './WorkItems.module.scss';interface FilterState {
  activeType: string;
  text: string;
  state: string;
  assignee: string;
  priority: string;
  iterationPath: string;
  areaPath: string;
  tags: string;
}

interface WorkItemFiltersProps {
  types: WorkItemTypeDef[];
  iterations: string[];
  areas: string[];
  members: string[];
  /** Available tag names fetched from ADO for the tag filter dropdown. */
  tagOptions: string[];
  filter: FilterState;
  totalCount: number;
  loading: boolean;
  onFilterChange: (partial: Partial<FilterState>) => void;
  onTypeChange: (type: string) => void;
  onRefresh: () => void;
  onCreate: () => void;
}

const PRIORITIES = [
  { value: '', label: '全部优先级' },
  { value: '1', label: '1 - 紧急' },
  { value: '2', label: '2 - 高' },
  { value: '3', label: '3 - 中' },
  { value: '4', label: '4 - 低' },
];

export function WorkItemFilters({
  types,
  iterations,
  areas,
  members,
  tagOptions,
  filter,
  totalCount,
  loading,
  onFilterChange,
  onTypeChange,
  onRefresh,
  onCreate,
}: WorkItemFiltersProps) {
  return (
    <div className={styles.filterBar}>
      {/* Type tabs */}
      <div className={styles.typeTabs}>
        <button
          className={`${styles.typeTab} ${filter.activeType === '' ? styles.typeTabActive : ''}`}
          onClick={() => onTypeChange('')}
        >
          全部
        </button>
        {types.map((t) => (
          <button
            key={t.name}
            className={`${styles.typeTab} ${filter.activeType === t.name ? styles.typeTabActive : ''}`}
            onClick={() => onTypeChange(t.name)}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className={styles.filterRow}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="搜索标题 / #ID..."
          value={filter.text}
          onChange={(e) => onFilterChange({ text: e.target.value })}
        />

        {(() => {
          const activeDef = filter.activeType
            ? types.find((t) => t.name === filter.activeType)
            : null;
          const stateNames = activeDef?.states && activeDef.states.length > 0
            ? activeDef.states.map((s) => s.name)
            : [
                ...new Set(
                  types.flatMap((t) => (t.states ?? []).map((s) => s.name)),
                ),
              ];
          return (
            <ComboSelect
              value={filter.state}
              onChange={(v) => onFilterChange({ state: v })}
              options={stateNames}
              placeholder="全部状态"
              clearable
              className={styles.filterCombo}
            />
          );
        })()}

        <ComboSelect
          value={filter.assignee}
          onChange={(v) => onFilterChange({ assignee: v })}
          options={members}
          placeholder="全部成员"
          clearable
          className={styles.filterCombo}
        />

        <ComboSelect
          value={filter.priority}
          onChange={(v) => onFilterChange({ priority: v })}
          options={PRIORITIES.slice(1)}
          placeholder="全部优先级"
          clearable
          className={styles.filterCombo}
        />

        {iterations.length > 0 && (
          <ComboSelect
            value={filter.iterationPath}
            onChange={(v) => onFilterChange({ iterationPath: v })}
            options={iterations}
            placeholder="全部迭代"
            clearable
            className={styles.filterCombo}
          />
        )}

        {areas.length > 0 && (
          <ComboSelect
            value={filter.areaPath}
            onChange={(v) => onFilterChange({ areaPath: v })}
            options={areas}
            placeholder="全部区域"
            clearable
            className={styles.filterCombo}
          />
        )}

        <ComboSelect
          value={filter.tags}
          onChange={(v) => onFilterChange({ tags: v })}
          options={tagOptions}
          placeholder="按标签筛选"
          clearable
          className={styles.filterCombo}
        />

        <span className={styles.countBadge}>{loading ? '…' : totalCount}</span>

        <button className={styles.refreshBtn} onClick={onRefresh} title="刷新" disabled={loading}>
          ↺
        </button>

        <button className={styles.createBtn} onClick={onCreate} disabled={loading} title="新建工作项">
          + 新建
        </button>
      </div>
    </div>
  );
}
