/** Work Items dialog lifecycle: open/close drawers and create dialogs. */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { bridgeCall, bridgeSnap } from './helpers';
import { uiBridge } from './uiBridge';

export const devopsWorkitemsOpenDrawer = defineTool({
  name: 'devops_workitems_open_drawer',
  group: 'DevOps',
  description:
    'Open a detail drawer for a work item. Use a semantic dialogId (e.g. "drawer-task-42") ' +
    'for multi-drawer support. Waits for item load.',
  parameters: z.object({
    dialogId: z.string().describe('Semantic ID, e.g. "drawer-task-42".'),
    itemId: z.number().int().describe('Numeric work item ID.'),
  }),
  execute: async ({ dialogId, itemId }) => {
    await bridgeCall('wi.openDrawer', dialogId, itemId);
    await uiBridge.waitUntil(() => uiBridge.isRegistered(`drawer.${dialogId}.getState`), 5_000);
    await uiBridge.waitUntil(() => {
      const s = bridgeSnap<{ loading: boolean; item: unknown }>(`drawer.${dialogId}.getState`);
      return !s.loading;
    });
    const s = bridgeSnap<{ item: unknown; tab: string }>(`drawer.${dialogId}.getState`);
    return { dialogId, itemId, item: s.item, activeTab: s.tab };
  },
});

export const devopsWorkitemsCloseDrawer = defineTool({
  name: 'devops_workitems_close_drawer',
  group: 'DevOps',
  description: 'Close a specific drawer by its dialogId.',
  parameters: z.object({
    dialogId: z.string().describe('The drawer identifier from devops_workitems_open_drawer.'),
  }),
  execute: async ({ dialogId }) => {
    await bridgeCall('wi.closeDrawer', dialogId);
    return { dialogId, success: true };
  },
});

export const devopsWorkitemsOpenCreate = defineTool({
  name: 'devops_workitems_open_create',
  group: 'DevOps',
  description:
    'Open a new create work item dialog. Use a semantic dialogId (e.g. "create-bug-1") ' +
    'for multi-dialog support. After this, use create_form_* tools with the same dialogId.',
  parameters: z.object({
    dialogId: z.string().default('default').describe('Semantic ID, e.g. "create-bug-42".'),
    defaultType: z.string().optional().describe('Pre-select a work item type.'),
  }),
  execute: async ({ dialogId, defaultType }) => {
    await bridgeCall('wi.openCreateDialog', dialogId, defaultType);
    await uiBridge.waitUntil(() => uiBridge.isRegistered(`wi.createForm.${dialogId}.getState`), 5_000);
    return { dialogId, showCreate: true };
  },
});

export const devopsWorkitemsCloseCreate = defineTool({
  name: 'devops_workitems_close_create',
  group: 'DevOps',
  description: 'Close a create dialog by dialogId without saving.',
  parameters: z.object({
    dialogId: z.string().default('default').describe('The dialog identifier from devops_workitems_open_create.'),
  }),
  execute: async ({ dialogId }) => {
    const ns = `wi.createForm.${dialogId}`;
    if (uiBridge.isRegistered(`${ns}.cancel`)) {
      await bridgeCall(`${ns}.cancel`);
    } else {
      await bridgeCall('wi.closeCreateDialog', dialogId);
    }
    return { dialogId, showCreate: false };
  },
});
