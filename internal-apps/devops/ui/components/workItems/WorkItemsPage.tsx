import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  fetchWorkItemTypes,
  fetchWorkItemFields,
  fetchFieldAllowedValues,
  fetchFilteredWorkItemIds,
  fetchWorkItemDetails,
  fetchIterations,
  fetchAreas,
  fetchProjectMembers,
  fetchProjectTags,
  composeFilter,
  updateWorkItem,
} from '../../api';
import type { WorkItemTypeDef, WorkItemFieldDef, WorkItem, WorkItemApiFilter, WorkItemIdPage, WorkItemPatch } from '../../api';
import { WorkItemFilters } from './WorkItemFilters';
import { WorkItemTable } from './WorkItemTable';
import { WorkItemDialog } from './WorkItemDialog';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { Pagination } from '../shared/Pagination';
import { uiBridge } from '../../tools/uiBridge';
import styles from './WorkItems.module.scss';

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;

interface WorkItemsPageProps {
  collectionUrl: string;
  project: string;
  pat: string;
}

interface FilterState {
  activeType: string;
  text: string;
  state: string;
  assignee: string;
  priority: string;
  iterationPath: string;
  areaPath: string;
  /** Single tag filter — items must CONTAIN this tag. */
  tags: string;
}

const DEFAULT_FILTER: FilterState = {
  activeType: '',
  text: '',
  state: '',
  assignee: '',
  priority: '',
  iterationPath: '',
  areaPath: '',
  tags: '',
};

export function WorkItemsPage({ collectionUrl, project, pat }: WorkItemsPageProps) {
  // Supporting data
  const [types, setTypes] = useState<WorkItemTypeDef[]>([]);
  const [fieldDefs, setFieldDefs] = useState<WorkItemFieldDef[]>([]);
  const [iterations, setIterations] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(50);
  const [supportLoading, setSupportLoading] = useState(true);

  // Filter
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);

  // Work items data
  const [idPage, setIdPage] = useState<WorkItemIdPage>({ ids: [], isCapped: false, cap: 500 });
  const [items, setItems] = useState<WorkItem[]>([]);
  const [page, setPage] = useState(0);
  const [loadingIds, setLoadingIds] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Accumulate tags seen in loaded items (supplements / falls back from the API call).
  // Runs whenever a new page of items is fetched.
  useEffect(() => {
    if (items.length === 0) return;
    setTagOptions((prev) => {
      const merged = new Set(prev);
      let hasNew = false;
      for (const item of items) {
        if (item.tags) {
          for (const tag of item.tags.split(';').map((t) => t.trim()).filter(Boolean)) {
            if (!merged.has(tag)) { merged.add(tag); hasNew = true; }
          }
        }
      }
      if (!hasNew) return prev;
      return Array.from(merged).sort((a, b) => a.localeCompare(b));
    });
  }, [items]);

  // ── Dialog ID counter ───────────────────────────────────────────────────
  const dialogIdCounter = useRef(0);

  // ── Multi-dialog state ──────────────────────────────────────────────────
  // Each dialog has a semantic ID + work item number.
  const [dialogs, setDialogs] = useState<Array<{ id: string; itemId: number }>>([]);

  // ── Multi-create-dialog state ───────────────────────────────────────────
  // Each create dialog has a semantic ID + per-dialog saving/error state.
  interface CreateDialogInfo {
    id: string;
    saving: boolean;
    error: string | null;
    selectedType: string;
  }
  const [createDialogs, setCreateDialogs] = useState<CreateDialogInfo[]>([]);

  // ── Debounced refresh ────────────────────────────────────────────────────
  // Multiple saves in rapid succession (e.g. batch save) merge into one refresh.
  // Uses refs to avoid stale closures.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const capRef = useRef(idPage.cap);
  capRef.current = idPage.cap;
  function scheduleRefresh() {
    if (!refreshTimer.current) {
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        fetchIds(filterRef.current, capRef.current);
      }, 300);
    }
  }

  // Abort controllers for cancellation
  const idsAbortRef = useRef<AbortController | null>(null);

  // ── Bridge state ref (always current, safe to read in handlers) ───────────
  const stateRef = useRef({
    types, fieldDefs, iterations, areas, members, tagOptions,
    supportLoading, filter, idPage, items, page, pageSize,
    loadingIds, loadingItems, error, dialogs, createDialogs,
  });
  stateRef.current = {
    types, fieldDefs, iterations, areas, members, tagOptions,
    supportLoading, filter, idPage, items, page, pageSize,
    loadingIds, loadingItems, error, dialogs, createDialogs,
  };

  // ── Bridge registration ───────────────────────────────────────────────────
  useEffect(() => {
    uiBridge.register('wi.getState', () => {
      const s = stateRef.current;
      return {
        // ── loading flags ──────────────────────────────────────────────────
        supportLoading: s.supportLoading,
        loadingIds: s.loadingIds,
        loadingItems: s.loadingItems,
        error: s.error,
        // ── filter options (use exact strings when calling set_type / set_filter) ──
        types: s.types.map((t) => {
          // Include required custom fields so the agent knows what must be set before submit
          const raw = t as unknown as Record<string, unknown>;
          const rawFields = Array.isArray(raw.fields)
            ? (raw.fields as Array<{ referenceName: string; name: string; alwaysRequired?: boolean }>)
            : [];
          return {
            name: t.name,
            states: (t.states ?? []).map((st) => st.name),
            requiredCustomFields: rawFields
              .filter((f) => f.alwaysRequired && f.referenceName?.startsWith('Custom.'))
              .map((f) => ({ referenceName: f.referenceName, name: f.name })),
          };
        }),
        members: s.members,
        iterations: s.iterations,
        areas: s.areas,
        /** Available tag names for the tag filter. */
        tagOptions: s.tagOptions,
        // ── active filter ──────────────────────────────────────────────────
        filter: s.filter,
        // ── results ────────────────────────────────────────────────────────
        totalCount: s.idPage.ids.length,
        page: s.page,
        pageSize:  s.pageSize,
        pageCount: Math.ceil(s.idPage.ids.length / s.pageSize),
        isCapped: s.idPage.isCapped,
        cap: s.idPage.cap,
        items: s.items.map((it) => ({
          id: it.id,
          type: it.type,
          title: it.title,
          state: it.state,
          assignedTo: it.assignedTo,
          priority: it.priority,
          iterationPath: it.iterationPath,
          areaPath: it.areaPath,
          tags: it.tags,
        })),
        // ── field definitions (for agent to know which fields have options) ──
        // Includes all editable fields (custom + a handful of system fields that
        // have picklist / identity semantics).
        fieldDefs: s.fieldDefs
          .filter((f) => !f.readOnly)
          .map((f) => ({
            referenceName: f.referenceName,
            name: f.name,
            type: f.type,
            isCustom: f.isCustom ?? false,
            isPicklist: f.isPicklist ?? false,
            isIdentity: f.isIdentity ?? false,
          })),
        // ── Multi-dialog UI state ──────────────────────────────────────────
        dialogs: s.dialogs.map((d) => ({ id: d.id, itemId: d.itemId })),
        createDialogs: s.createDialogs.map((d) => ({
          id: d.id,
          saving: d.saving,
          error: d.error,
        })),
      };
    });
    /**
     * Fetch the allowed values for a specific field within a work item type.
     * Returns [] when the field has no server-side constraint (free-text).
     */
    uiBridge.register(
      'wi.getFieldOptions',
      (workItemType: string, fieldRef: string) =>
        fetchFieldAllowedValues(collectionUrl, project, pat, workItemType, fieldRef),
    );
    uiBridge.register('wi.setFilter', (partial: Partial<FilterState>) =>
      setFilter((prev) => ({ ...prev, ...partial })),
    );
    uiBridge.register('wi.setType', (type: string) =>
      setFilter((prev) => ({ ...prev, activeType: type })),
    );
    uiBridge.register('wi.setPage', setPage);
    uiBridge.register('wi.setPageSize', (size: number) => { setPageSize(size); setPage(0); });
    // Multi-dialog: open / close view dialogs and create dialogs by semantic ID
    // Register both 'dialog' (new) and 'drawer' (legacy compat) bridge keys.
    uiBridge.register('wi.openDialog', (dialogId: string, itemId: number) => {
      setDialogs((prev) => (prev.some((d) => d.id === dialogId) ? prev : [...prev, { id: dialogId, itemId }]));
    });
    uiBridge.register('wi.openDrawer', (dialogId: string, itemId: number) => {
      setDialogs((prev) => (prev.some((d) => d.id === dialogId) ? prev : [...prev, { id: dialogId, itemId }]));
    });
    uiBridge.register('wi.closeDialog', (dialogId: string) => {
      setDialogs((prev) => prev.filter((d) => d.id !== dialogId));
    });
    uiBridge.register('wi.closeDrawer', (dialogId: string) => {
      setDialogs((prev) => prev.filter((d) => d.id !== dialogId));
    });
    uiBridge.register('wi.openCreateDialog', (dialogId: string, defaultType?: string) => {
      setCreateDialogs((prev) =>
        prev.some((d) => d.id === dialogId)
          ? prev
          : [...prev, { id: dialogId, saving: false, error: null, selectedType: defaultType ?? '' }],
      );
    });
    uiBridge.register('wi.closeCreateDialog', (dialogId: string) => {
      setCreateDialogs((prev) => prev.filter((d) => d.id !== dialogId));
    });
    return () => {
      uiBridge.unregister('wi.getState');
      uiBridge.unregister('wi.getFieldOptions');
      uiBridge.unregister('wi.setFilter');
      uiBridge.unregister('wi.setType');
      uiBridge.unregister('wi.setPage');
      uiBridge.unregister('wi.setPageSize');
      uiBridge.unregister('wi.openDialog');
      uiBridge.unregister('wi.openDrawer');
      uiBridge.unregister('wi.closeDialog');
      uiBridge.unregister('wi.closeDrawer');
      uiBridge.unregister('wi.openCreateDialog');
      uiBridge.unregister('wi.closeCreateDialog');
    };
  }, []);

  // ── Load supporting data ──────────────────────────────────────────────────

  useEffect(() => {
    setSupportLoading(true);
    setFilter(DEFAULT_FILTER);
    setIdPage({ ids: [], isCapped: false, cap: 500 });
    setItems([]);
    setPage(0);

    Promise.all([
      fetchWorkItemTypes(collectionUrl, project, pat),
      fetchWorkItemFields(collectionUrl, project, pat),
      fetchIterations(collectionUrl, project, pat),
      fetchAreas(collectionUrl, project, pat),
      fetchProjectMembers(collectionUrl, project, pat),
      fetchProjectTags(collectionUrl, project, pat),
    ])
      .then(([t, defs, i, a, m, tgs]) => {
        setTypes(t);
        setFieldDefs(defs);
        setIterations(i);
        setAreas(a);
        setMembers(m);
        setTagOptions(tgs);
      })
      .catch(console.error)
      .finally(() => setSupportLoading(false));
  }, [collectionUrl, project, pat]);

  // ── Fetch IDs when filter changes ─────────────────────────────────────────

  const fetchIds = useCallback(
    async (f: FilterState, cap = 500) => {
      idsAbortRef.current?.abort();
      idsAbortRef.current = new AbortController();

      setLoadingIds(true);
      setError(null);
      setPage(0);
      setItems([]);

      try {
        const apiFilter: WorkItemApiFilter = composeFilter(f.activeType, {
          text: f.text,
          state: f.state,
          assignee: f.assignee,
          priority: f.priority,
          iterationPath: f.iterationPath,
          areaPath: f.areaPath,
          tags: f.tags,
        });
        const result = await fetchFilteredWorkItemIds(collectionUrl, project, pat, apiFilter, cap);
        setIdPage(result);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setLoadingIds(false);
      }
    },
    [collectionUrl, project, pat],
  );

  useEffect(() => {
    if (!supportLoading) {
      fetchIds(filter);
    }
  }, [filter, supportLoading, fetchIds]);

  // Register fetchIds-based bridge actions after fetchIds is stable
  useEffect(() => {
    uiBridge.register('wi.refresh', () => fetchIds(stateRef.current.filter, stateRef.current.idPage.cap));
    uiBridge.register('wi.expandCap', () => {
      const nextCap = stateRef.current.idPage.cap * 5;
      return fetchIds(stateRef.current.filter, nextCap);
    });
    /**
     * Batch-update many work items at once. Uses updateWorkItem API directly
     * (not the drawer UI), so it's much faster than editing one-by-one.
     * Processes items in parallel batches of 5 to avoid overwhelming ADO rate limits.
     */
    uiBridge.register('wi.batchUpdate',
      async (ids: number[], field: string, value: string, isCustomField: boolean) => {
        const BATCH_SIZE = 5;
        const results: Array<{ id: number; success: boolean; error?: string }> = [];
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const batch = ids.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (id) => {
              try {
                if (isCustomField) {
                  await updateWorkItem(collectionUrl, project, pat, id, {
                    customFields: { [field]: value },
                  });
                } else {
                  // Standard field — map tool field names to WorkItemPatch keys
                  const patch: WorkItemPatch = {};
                  if (field === 'priority') {
                    patch.priority = parseInt(value, 10) || undefined;
                  } else {
                    (patch as Record<string, unknown>)[field] = value;
                  }
                  await updateWorkItem(collectionUrl, project, pat, id, patch);
                }
                return { id, success: true };
              } catch (e) {
                return { id, success: false, error: e instanceof Error ? e.message : String(e) };
              }
            }),
          );
          results.push(...batchResults);
        }
        // Refresh the work items list after batch update
        scheduleRefresh();
        return results;
      },
    );
    // wi.create is no longer used — create flows go through the dialog-specific
    // form submit path (wi.createForm.<dialogId>.submit).
    return () => {
      uiBridge.unregister('wi.refresh');
      uiBridge.unregister('wi.expandCap');
      uiBridge.unregister('wi.create');
      uiBridge.unregister('wi.batchUpdate');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchIds]);

  // ── Fetch page details ────────────────────────────────────────────────────

  useEffect(() => {
    const pageIds = idPage.ids.slice(page * pageSize, (page + 1) * pageSize);
    if (pageIds.length === 0) {
      setItems([]);
      return;
    }

    setLoadingItems(true);
    fetchWorkItemDetails(collectionUrl, pat, pageIds)
      .then(setItems)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingItems(false));
  }, [idPage.ids, page, pageSize, collectionUrl, pat]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleFilterChange(partial: Partial<FilterState>) {
    setFilter((prev) => ({ ...prev, ...partial }));
  }

  function handleTypeChange(type: string) {
    setFilter((prev) => ({ ...prev, activeType: type }));
  }

  function handleRefresh() {
    fetchIds(filter, idPage.cap);
  }

  function handleExpandCap() {
    const nextCap = idPage.cap * 5;
    fetchIds(filter, nextCap);
  }

  if (supportLoading) {
    return (
      <div className={styles.page}>
        <Spinner label="加载项目数据..." />
      </div>
    );
  }

  const isLoading = loadingIds || loadingItems;

  return (
    <div className={styles.page}>
      <WorkItemFilters
        types={types}
        iterations={iterations}
        areas={areas}
        members={members}
        tagOptions={tagOptions}
        filter={filter}
        totalCount={idPage.ids.length}
        loading={isLoading}
        onFilterChange={handleFilterChange}
        onTypeChange={handleTypeChange}
        onRefresh={handleRefresh}
        onCreate={() => {
          const id = ++dialogIdCounter.current;
          const dialogId = `create-${id}`;
          setCreateDialogs((prev) =>
            prev.some((d) => d.id === dialogId) ? prev : [...prev, { id: dialogId, saving: false, error: null, selectedType: '' }],
          );
        }}
      />

      <div className={styles.body}>
        {error && (
          <div className={styles.errorBanner} role="alert">
            <span>⚠</span> {error}
          </div>
        )}

        {loadingIds ? (
          <Spinner label="查询工作项..." />
        ) : idPage.ids.length === 0 ? (
          <EmptyState
            icon="☑"
            title="没有找到工作项"
            description="尝试调整过滤条件或新建工作项"
          />
        ) : loadingItems ? (
          <Spinner label="加载详情..." />
        ) : (
          <WorkItemTable
            items={items}
            onRowClick={(id) => {
              const dialogId = `dialog-${id}`;
              setDialogs((prev) =>
                prev.some((d) => d.id === dialogId) ? prev : [...prev, { id: dialogId, itemId: id }],
              );
            }}
            selectedId={dialogs.length > 0 ? dialogs[dialogs.length - 1].itemId : null}
          />
        )}

        {idPage.isCapped && !loadingIds && (
          <div className={styles.cappedBanner}>
            <span>仅显示前 {idPage.cap} 条结果，实际数量更多</span>
            <button className={styles.cappedBtn} onClick={handleExpandCap}>
              加载更多（{idPage.cap * 5} 条）
            </button>
          </div>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={idPage.ids.length}
        isCapped={idPage.isCapped}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
      />

      {/* Batch action bar when multiple dialogs are open */}
      {(dialogs.length > 1 || createDialogs.length > 0) && (
        <div className={styles.batchBar}>
          <span className={styles.batchCount}>
            {dialogs.length + createDialogs.length} 个弹窗
            {dialogs.length > 0 && <> · {dialogs.length} 个查看/编辑</>}
            {createDialogs.length > 0 && <> · {createDialogs.length} 个新建</>}
          </span>
          <div className={styles.batchActions}>
            {dialogs.length > 0 && (
              <button
                className={styles.batchBtn}
                onClick={() => {
                  // Close all view dialogs
                  const ids = [...dialogs];
                  ids.forEach((d) => uiBridge.call('wi.closeDialog', d.id).catch(() => {}));
                }}
              >
                关闭全部查看弹窗
              </button>
            )}
            {createDialogs.length > 0 && (
              <button
                className={styles.batchBtn}
                onClick={() => {
                  const ids = [...createDialogs];
                  ids.forEach((cd) => setCreateDialogs((prev) => prev.filter((d) => d.id !== cd.id)));
                }}
              >
                关闭全部新建弹窗
              </button>
            )}
          </div>
        </div>
      )}

      {/*
        View and create dialogs — each rendered as a WorkItemDialog.
        CSS Grid auto-fill tiles them in a scrollable overlay.
      */}
      {(dialogs.length > 0 || createDialogs.length > 0) && (
        <div className={styles.multiDialogContainer}>
          {dialogs.map((d) => (
            <WorkItemDialog
              key={d.id}
              mode="view"
              dialogId={d.id}
              itemId={d.itemId}
              collectionUrl={collectionUrl} project={project} pat={pat}
              types={types} iterations={iterations} areas={areas}
              members={members} fieldDefs={fieldDefs} tagOptions={tagOptions}
              onClose={() => uiBridge.call('wi.closeDialog', d.id).catch(() => {})}
              onSaved={scheduleRefresh}
            />
          ))}
          {createDialogs.map((cd) => (
            <WorkItemDialog
              key={cd.id}
              mode="create"
              dialogId={cd.id}
              defaultType={cd.selectedType || filter.activeType || undefined}
              collectionUrl={collectionUrl} project={project} pat={pat}
              types={types} iterations={iterations} areas={areas}
              members={members} fieldDefs={fieldDefs} tagOptions={tagOptions}
              onClose={() => setCreateDialogs((prev) => prev.filter((d) => d.id !== cd.id))}
              onSaved={scheduleRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
