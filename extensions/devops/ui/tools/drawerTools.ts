/** Drawer tab switching tools. */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import { bridgeCall, bridgeSnap } from './helpers';
import { uiBridge } from './uiBridge';

export const devopsDrawerSwitchTab = defineTool({
  name: 'devops_drawer_switch_tab',
  group: 'DevOps',
  description: 'Switch drawer tab: detail, edit, comments, history, attachments.',
  parameters: z.object({
    dialogId: z.string().describe('The drawer identifier.'),
    tab: z.enum(['detail', 'edit', 'comments', 'history', 'attachments']),
  }),
  execute: async ({ dialogId, tab }) => {
    const DK = `drawer.${dialogId}`;
    await bridgeCall(`${DK}.setTab`, tab);
    if (tab === 'edit') await uiBridge.waitUntil(() => uiBridge.isRegistered(`${DK}.edit.getState`), 5_000);
    if (tab === 'comments') {
      await uiBridge.waitUntil(() => !bridgeSnap<{ commentsLoading: boolean }>(`${DK}.getState`).commentsLoading, 15_000);
    }
    if (tab === 'history') {
      await uiBridge.waitUntil(() => !bridgeSnap<{ updatesLoading: boolean }>(`${DK}.getState`).updatesLoading, 15_000);
    }
    return { dialogId, activeTab: tab };
  },
});
