/** Work Items core tools: state, metadata, filter, pagination, type tabs. */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { bridgeCall, bridgeSnap, stateResult } from './helpers';
import { uiBridge } from './uiBridge';

export const devopsWorkitemsGetState = defineTool({
  name: 'devops_workitems_get_state',
  group: 'DevOps',
  description:
    'Read live work items page state: filter, loading flags, pagination, items, open drawers/dialogs. ' +
    'Call frequently. Use devops_workitems_get_metadata for reference data.',
  parameters: z.object({}),
  execute: async () => {
    const s = bridgeSnap<Record<string, unknown>>('wi.getState');
    return {
      supportLoading: s.supportLoading, loadingIds: s.loadingIds, loadingItems: s.loadingItems, error: s.error,
      filter: s.filter,
      totalCount: s.totalCount, page: s.page, pageSize: s.pageSize as number,
      pageCount: s.pageCount, isCapped: s.isCapped, cap: s.cap,
      items: (s.items as Array<Record<string, unknown>>).map((it) => ({
        id: it.id, type: it.type, title: it.title, state: it.state,
        assignedTo: it.assignedTo, priority: it.priority,
      })),
      drawers: (s.drawers as Array<{ id: string; itemId: number }> | undefined) ?? [],
      createDialogs: (s.createDialogs as Array<{ id: string; saving: boolean; error: string | null }> | undefined) ?? [],
    };
  },
});

export const devopsWorkitemsGetMetadata = defineTool({
  name: 'devops_workitems_get_metadata',
  group: 'DevOps',
  description:
    'Call ONCE per session after supportLoading=false. Returns types, members, iterations, areas, tagOptions, ' +
    'and customFields with allowedValues for picklist fields. ' +
    '⚠️ 对于 isPicklist=true 的字段，allowedValues 数组就是该下拉字段所有可选值 —— 设置时值必须完全匹配其中之一。',
  parameters: z.object({}),
  execute: async () => {
    const s = bridgeSnap<Record<string, unknown>>('wi.getState');
    const types = (s.types ?? []) as Array<{ name: string }>;
    // Determine which work item type to query picklist values for:
    // use active type if set, otherwise fall back to the first available type.
    const activeType =
      ((s.filter as Record<string, unknown> | undefined)?.activeType as string | undefined) ||
      types[0]?.name ||
      'Task';
    const rawFields = (s.fieldDefs ?? []) as Array<Record<string, unknown>>;
    const customFields = rawFields.filter((f) => f.isCustom);
    // For picklist fields, fetch allowed values in parallel
    const enrichedFields = await Promise.all(
      customFields.map(async (f) => {
        if (f.isPicklist && activeType) {
          try {
            const options = await bridgeCall<string[]>('wi.getFieldOptions', activeType, f.referenceName);
            return { ...f, allowedValues: options };
          } catch {
            return { ...f, allowedValues: [] };
          }
        }
        return { ...f, allowedValues: [] };
      }),
    );
    return {
      types: s.types, members: s.members, iterations: s.iterations, areas: s.areas,
      tagOptions: s.tagOptions,
      customFields: enrichedFields,
    };
  },
});

export const devopsWorkitemsSetFilter = defineTool({
  name: 'devops_workitems_set_filter',
  group: 'DevOps',
  description:
    'Update work-item filters. All optional. Use exact strings from get_state/get_metadata. Pass "" to clear a field.',
  parameters: z.object({
    text: z.string().optional().describe('Free-text (title or #ID).'),
    state: z.string().optional().describe('Exact state name. ""=clear.'),
    assignee: z.string().optional().describe('Exact displayName from members[]. ""=clear.'),
    priority: z.enum(['', '1', '2', '3', '4']).optional().describe('""=all.'),
    iterationPath: z.string().optional().describe('Exact iteration path. ""=clear.'),
    areaPath: z.string().optional().describe('Exact area path. ""=clear.'),
    tags: z.string().optional().describe('Single tag name from tagOptions[]. ""=clear.'),
  }),
  execute: async (partial) => {
    await bridgeCall('wi.setFilter', partial);
    // Wait for filter to actually update in React state
    await uiBridge.waitUntil(() => {
      const current = bridgeSnap<{ filter: Record<string, string> }>('wi.getState').filter;
      return Object.entries(partial).every(([k, v]) => current[k] === v);
    });
    await uiBridge.waitUntil(() => !bridgeSnap<{ loadingIds: boolean }>('wi.getState').loadingIds);
    const s = bridgeSnap<{ filter: unknown; totalCount: number }>('wi.getState');
    return { filter: s.filter, totalCount: s.totalCount };
  },
});

export const devopsWorkitemsExpandCap = defineTool({
  name: 'devops_workitems_expand_cap',
  group: 'DevOps',
  description: 'Click "Load More" to multiply result cap by 5.',
  parameters: z.object({}),
  execute: async () => {
    await bridgeCall('wi.expandCap');
    await uiBridge.waitUntil(() => !bridgeSnap<{ loadingIds: boolean }>('wi.getState').loadingIds);
    return stateResult(bridgeSnap<{ totalCount: number; isCapped: boolean; cap: number }>('wi.getState'));
  },
});

export const devopsWorkitemsSetPage = defineTool({
  name: 'devops_workitems_set_page',
  group: 'DevOps',
  description: 'Go to a specific page (0-based index).',
  parameters: z.object({
    page: z.number().int().min(0).describe('0-based page index.'),
  }),
  execute: async ({ page }) => {
    await bridgeCall('wi.setPage', page);
    // Wait for React to re-render (page changes) before waiting for loading to complete
    await uiBridge.waitUntil(() => bridgeSnap<{ page: number }>('wi.getState').page === page);
    await uiBridge.waitUntil(() => !bridgeSnap<{ loadingItems: boolean }>('wi.getState').loadingItems);
    const s = bridgeSnap<{ items: unknown[]; page: number }>('wi.getState');
    return { page: s.page, itemsOnPage: s.items.length };
  },
});

export const devopsWorkitemsSetPageSize = defineTool({
  name: 'devops_workitems_set_page_size',
  group: 'DevOps',
  description: 'Change items per page (20/50/100/200). Resets to page 0.',
  parameters: z.object({
    pageSize: z.union([z.literal(20), z.literal(50), z.literal(100), z.literal(200)]),
  }),
  execute: async ({ pageSize }) => {
    await bridgeCall('wi.setPageSize', pageSize);
    // Wait for React to re-render: pageSize changed AND page reset to 0
    await uiBridge.waitUntil(
      () => {
        const s = bridgeSnap<{ pageSize: number; page: number }>('wi.getState');
        return s.pageSize === pageSize && s.page === 0;
      },
    );
    await uiBridge.waitUntil(() => !bridgeSnap<{ loadingItems: boolean }>('wi.getState').loadingItems);
    const s = bridgeSnap<{ pageSize: number; pageCount: number; totalCount: number }>('wi.getState');
    return { pageSize: s.pageSize, pageCount: s.pageCount, totalCount: s.totalCount };
  },
});

export const devopsWorkitemsGetFieldOptions = defineTool({
  name: 'devops_workitems_get_field_options',
  group: 'DevOps',
  description:
    'Fetch allowed picklist values for a (type + fieldRef). Returns string[]. ' +
    'Empty array = free-text (no server-side constraint, any value accepted). ' +
    'Use this when you see isPicklist=true in metadata to discover all valid options.',
  parameters: z.object({
    workItemType: z.string().describe('Exact type name from types[].name, e.g. "Bug" or "Task".'),
    fieldRef: z.string().describe('ADO field ref, e.g. "Custom.f145ff4d-..." or "Custom.AiUsageLevel".'),
  }),
  execute: async ({ workItemType, fieldRef }) => {
    const options = await bridgeCall<string[]>('wi.getFieldOptions', workItemType, fieldRef);
    return { workItemType, fieldRef, options };
  },
});
