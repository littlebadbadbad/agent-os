/** Drawer tab switching tools. */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DevOpsBridge } from '../types';
import type { Tool } from '@agent-type';

export function createDrawerTools(bridge: DevOpsBridge): Tool[] {
  const devopsDrawerSwitchTab = defineTool({
    name: 'devops_drawer_switch_tab',
    group: 'DevOps',
    description: 'Switch drawer tab: detail, edit, comments, history, attachments.',
    parameters: z.object({
      dialogId: z.string().describe('The drawer identifier.'),
      tab: z.enum(['detail', 'edit', 'comments', 'history', 'attachments']),
    }),
    execute: async ({ dialogId, tab }) => {
      const DK = `drawer.${dialogId}`;
      await bridge.callHandler(`${DK}.setTab`, tab);
      if (tab === 'edit') await bridge.waitUntil(() => bridge.isRegistered(`${DK}.edit.getState`), 5_000);
      if (tab === 'comments') {
        await bridge.waitUntil(() => !bridge.snapshot<{ commentsLoading: boolean }>(`${DK}.getState`).commentsLoading, 15_000);
      }
      if (tab === 'history') {
        await bridge.waitUntil(() => !bridge.snapshot<{ updatesLoading: boolean }>(`${DK}.getState`).updatesLoading, 15_000);
      }
      return { dialogId, activeTab: tab };
    },
  });

  return [devopsDrawerSwitchTab];
}
