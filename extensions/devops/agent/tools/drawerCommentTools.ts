/** Drawer comment and delete tools. */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DevOpsBridge } from '../types';
import type { Tool } from '@agent-type';

export function createDrawerCommentTools(bridge: DevOpsBridge): Tool[] {
  const devopsDrawerAddComment = defineTool({
    name: 'devops_drawer_add_comment',
    group: 'DevOps',
    description: 'Type and post a comment. Drawer must be on the "comments" tab.',
    parameters: z.object({
      dialogId: z.string().describe('The drawer identifier.'),
      text: z.string().describe('Comment text (HTML supported).'),
    }),
    execute: async ({ dialogId, text }) => {
      const DK = `drawer.${dialogId}`;
      await bridge.callHandler(`${DK}.setCommentText`, text);
      await bridge.callHandler(`${DK}.submitComment`);
      await bridge.waitUntil(() => {
        const s = bridge.snapshot<{ submittingComment: boolean; commentText: string }>(`${DK}.getState`);
        return !s.submittingComment && s.commentText === '';
      }, 15_000);
      return { dialogId, success: true };
    },
  });

  const devopsDrawerDeleteWorkitem = defineTool({
    name: 'devops_drawer_delete_workitem',
    group: 'DevOps',
    description: 'Delete the work item. Set confirm=true to confirm deletion (one-call full flow). confirm=false only shows the prompt without deleting.',
    parameters: z.object({
      dialogId: z.string().describe('The drawer identifier.'),
      confirm: z.boolean().default(false).describe('false=show prompt, true=confirm delete.'),
    }),
    execute: async ({ dialogId, confirm }) => {
      const DK = `drawer.${dialogId}`;
      await bridge.callHandler(`${DK}.initiateDelete`);
      if (confirm) {
        await bridge.waitUntil(() => bridge.snapshot<{ deleteConfirm: boolean }>(`${DK}.getState`).deleteConfirm, 3_000);
        await bridge.callHandler(`${DK}.initiateDelete`);
      }
      return { dialogId, success: true, confirmed: confirm };
    },
  });

  return [
    devopsDrawerAddComment,
    devopsDrawerDeleteWorkitem,
  ];
}
