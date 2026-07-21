/** Drawer edit form tools: batch field setters, parent, custom fields, save. */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { bridgeCall, bridgeSnap } from './helpers';
import { uiBridge } from './uiBridge';

const EDIT_FIELD_NAMES = [
  'title', 'state', 'assignedTo', 'priority',
  'iterationPath', 'areaPath', 'tags',
  'effort', 'originalEstimate', 'remainingWork', 'completedWork',
  'storyPoints', 'businessValue',
  'severity', 'activity', 'valueArea',
  'startDate', 'finishDate', 'targetDate',
  'description', 'acceptanceCriteria',
] as const;

export const devopsDrawerEditSetFields = defineTool({
  name: 'devops_drawer_edit_set_fields',
  group: 'DevOps',
  description: 'Set MULTIPLE drawer edit fields at once. All optional. Preferred over repeated set_field.',
  parameters: z.object({
    dialogId: z.string().describe('The drawer identifier.'),
    title: z.string().optional(),
    state: z.string().optional(),
    assignedTo: z.string().optional(),
    priority: z.string().optional().describe('"1"~"4".'),
    iterationPath: z.string().optional(),
    areaPath: z.string().optional(),
    tags: z.string().optional().describe('Semicolon-separated.'),
    effort: z.string().optional(),
    originalEstimate: z.string().optional(),
    remainingWork: z.string().optional(),
    completedWork: z.string().optional(),
    storyPoints: z.string().optional(),
    businessValue: z.string().optional(),
    severity: z.string().optional(),
    activity: z.string().optional(),
    valueArea: z.string().optional(),
    startDate: z.string().optional().describe('YYYY-MM-DD.'),
    finishDate: z.string().optional().describe('YYYY-MM-DD.'),
    targetDate: z.string().optional().describe('YYYY-MM-DD.'),
    description: z.string().optional().describe('HTML supported.'),
    acceptanceCriteria: z.string().optional().describe('HTML supported.'),
  }),
  execute: async (fields) => {
    const { dialogId, ...rest } = fields;
    const ns = `drawer.${dialogId}.edit`;
    const nonEmptyFields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (Object.keys(nonEmptyFields).length > 0) await bridgeCall(`${ns}.setFields`, nonEmptyFields);
    return { dialogId, fieldsSet: nonEmptyFields };
  },
});

export const devopsDrawerEditSetCustomField = defineTool({
  name: 'devops_drawer_edit_set_custom_field',
  group: 'DevOps',
  description: 'Set a custom field in drawer edit form by ADO reference name.',
  parameters: z.object({
    dialogId: z.string().describe('The drawer identifier.'),
    fieldRef: z.string().describe('ADO field ref, e.g. "Custom.MyField".'),
    value: z.string().describe('New value.'),
  }),
  execute: async ({ dialogId, fieldRef, value }) => {
    await bridgeCall(`drawer.${dialogId}.edit.setCustomField`, fieldRef, value);
    return { dialogId, fieldRef, value };
  },
});

export const devopsDrawerEditSearchParent = defineTool({
  name: 'devops_drawer_edit_search_parent',
  group: 'DevOps',
  description: 'Search for a parent work item in drawer edit form.',
  parameters: z.object({
    dialogId: z.string().describe('The drawer identifier.'),
    query: z.string().describe('Title text or #ID.'),
  }),
  execute: async ({ dialogId, query }) => {
    const results = await bridgeCall<unknown[]>(`drawer.${dialogId}.edit.searchParent`, query);
    return { dialogId, query, results };
  },
});

export const devopsDrawerEditSetParent = defineTool({
  name: 'devops_drawer_edit_set_parent',
  group: 'DevOps',
  description: 'Set or clear the parent (null to clear).',
  parameters: z.object({
    dialogId: z.string().describe('The drawer identifier.'),
    parent: z.object({ id: z.number(), title: z.string(), type: z.string() }).nullable(),
  }),
  execute: async ({ dialogId, parent }) => {
    await bridgeCall(`drawer.${dialogId}.edit.setParent`, parent);
    return { dialogId, parent };
  },
});

export const devopsDrawerEditSave = defineTool({
  name: 'devops_drawer_edit_save',
  group: 'DevOps',
  description: 'Save all edits and switch back to detail tab. Waits for completion.',
  parameters: z.object({
    dialogId: z.string().describe('The drawer identifier.'),
  }),
  execute: async ({ dialogId }) => {
    const DK = `drawer.${dialogId}`;
    await bridgeCall(`${DK}.edit.submit`);
    // Wait for saving to finish. If the save fails, saving will be false
    // but tab may still be 'edit'. Check for both success (tab='detail')
    // and failure (saveError present, tab stays 'edit') to avoid silent failures.
    await uiBridge.waitUntil(() => {
      const s = bridgeSnap<{ saving: boolean; tab: string; saveError: string | null }>(`${DK}.getState`);
      return !s.saving && (s.tab === 'detail' || s.saveError !== null);
    }, 15_000);
    const s = bridgeSnap<{ saveError: string | null }>(`${DK}.getState`);
    if (s.saveError) {
      return { dialogId, success: false, error: s.saveError };
    }
    return { dialogId, success: true };
  },
});
