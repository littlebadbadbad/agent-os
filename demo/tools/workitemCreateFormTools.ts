/** Create work item form tools: batch field setters, custom fields, submit. */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { bridgeCall, bridgeSnap } from './helpers';
import { uiBridge } from './uiBridge';

const FIELD_NAMES = [
  'type', 'title', 'state', 'assignedTo', 'priority',
  'iterationPath', 'areaPath', 'tags',
  'effort', 'originalEstimate', 'remainingWork', 'completedWork',
  'storyPoints', 'businessValue',
  'severity', 'activity', 'valueArea',
  'startDate', 'finishDate', 'targetDate',
  'description', 'acceptanceCriteria',
] as const;

export const devopsWorkitemsCreateFormSetFields = defineTool({
  name: 'devops_workitems_create_form_set_fields',
  group: 'DevOps',
  description:
    'Set MULTIPLE create-form fields at once. All optional. Preferred over repeated set_field calls.',
  parameters: z.object({
    dialogId: z.string().default('default').describe('Dialog identifier.'),
    type: z.string().optional().describe('Work item type (exact).'),
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
    const { dialogId, type, ...rest } = fields;
    const ns = `wi.createForm.${dialogId}`;
    if (type !== undefined) await bridgeCall(`${ns}.setType`, type);
    const nonEmptyFields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (Object.keys(nonEmptyFields).length > 0) await bridgeCall(`${ns}.setFields`, nonEmptyFields);
    return { dialogId, fieldsSet: { type, ...nonEmptyFields } };
  },
});

export const devopsWorkitemsCreateFormSetCustomField = defineTool({
  name: 'devops_workitems_create_form_set_custom_field',
  group: 'DevOps',
  description:
    'Set a custom field by ADO reference name (e.g. "Custom.Product"). ' +
    'Check types[].requiredCustomFields before submit — missing required fields cause ADO 400.',
  parameters: z.object({
    dialogId: z.string().default('default').describe('Dialog identifier.'),
    fieldRef: z.string().describe('ADO field ref, e.g. "Custom.Prodcut".'),
    value: z.string().describe('New value (string; numbers auto-converted).'),
  }),
  execute: async ({ dialogId, fieldRef, value }) => {
    await bridgeCall(`wi.createForm.${dialogId}.setCustomField`, fieldRef, value);
    return { dialogId, fieldRef, value };
  },
});

export const devopsWorkitemsCreateFormSubmit = defineTool({
  name: 'devops_workitems_create_form_submit',
  group: 'DevOps',
  description:
    'Submit the create dialog. Returns success or error. On error, dialog stays open for retry.',
  parameters: z.object({
    dialogId: z.string().default('default').describe('Dialog identifier.'),
  }),
  execute: async ({ dialogId }) => {
    const ns = `wi.createForm.${dialogId}`;
    await bridgeCall(`${ns}.submit`);
    await new Promise((r) => setTimeout(r, 400));
    await uiBridge.waitUntil(
      () => !uiBridge.isRegistered(`${ns}.getState`) ||
        !!bridgeSnap<{ createDialogs: Array<{ id: string; error: string | null }> }>('wi.getState')
          .createDialogs.find((d) => d.id === dialogId)?.error,
      15_000,
    );
    if (!uiBridge.isRegistered(`${ns}.getState`)) return { dialogId, success: true };
    const wiState = bridgeSnap<{ createDialogs: Array<{ id: string; error: string | null }> }>('wi.getState');
    const dialog = wiState.createDialogs.find((d) => d.id === dialogId);
    return { dialogId, success: false, error: dialog?.error ?? 'Unknown error' };
  },
});
