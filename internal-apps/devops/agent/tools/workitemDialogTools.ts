/** Work Items dialog lifecycle: open/close drawers and create dialogs. */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DevOpsBridge } from '../../ui/types';
import type { Tool } from '@agent-type';

export function createWorkitemDialogTools(bridge: DevOpsBridge): Tool[] {
  const devopsWorkitemsOpenDrawer = defineTool({
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
      await bridge.callHandler('wi.openDrawer', dialogId, itemId);
      await bridge.waitUntil(() => bridge.isRegistered(`drawer.${dialogId}.getState`), 5_000);
      await bridge.waitUntil(() => {
        const s = bridge.snapshot<{ loading: boolean; item: unknown }>(`drawer.${dialogId}.getState`);
        return !s.loading;
      });
      const s = bridge.snapshot<{ item: unknown; tab: string }>(`drawer.${dialogId}.getState`);
      return { dialogId, itemId, item: s.item, activeTab: s.tab };
    },
  });

  const devopsWorkitemsCloseDrawer = defineTool({
    name: 'devops_workitems_close_drawer',
    group: 'DevOps',
    description: 'Close a specific drawer by its dialogId.',
    parameters: z.object({
      dialogId: z.string().describe('The drawer identifier from devops_workitems_open_drawer.'),
    }),
    execute: async ({ dialogId }) => {
      await bridge.callHandler('wi.closeDrawer', dialogId);
      return { dialogId, success: true };
    },
  });

  const devopsWorkitemsOpenCreate = defineTool({
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
      await bridge.callHandler('wi.openCreateDialog', dialogId, defaultType);
      await bridge.waitUntil(() => bridge.isRegistered(`wi.createForm.${dialogId}.getState`), 5_000);
      return { dialogId, showCreate: true };
    },
  });

  const devopsWorkitemsCloseCreate = defineTool({
    name: 'devops_workitems_close_create',
    group: 'DevOps',
    description: 'Close a create dialog by dialogId without saving.',
    parameters: z.object({
      dialogId: z.string().default('default').describe('The dialog identifier from devops_workitems_open_create.'),
    }),
    execute: async ({ dialogId }) => {
      const ns = `wi.createForm.${dialogId}`;
      if (bridge.isRegistered(`${ns}.cancel`)) {
        await bridge.callHandler(`${ns}.cancel`);
      } else {
        await bridge.callHandler('wi.closeCreateDialog', dialogId);
      }
      return { dialogId, showCreate: false };
    },
  });

  return [
    devopsWorkitemsOpenDrawer,
    devopsWorkitemsCloseDrawer,
    devopsWorkitemsOpenCreate,
    devopsWorkitemsCloseCreate,
  ];
}
