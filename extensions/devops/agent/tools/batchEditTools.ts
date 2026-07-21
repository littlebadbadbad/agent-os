/**
 * Batch-edit tools: update many work items in one call.
 * Much faster than opening N drawers one-by-one.
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DevOpsBridge } from '../types';
import type { Tool } from '@agent-type';

export function createBatchEditTools(bridge: DevOpsBridge): Tool[] {
  const devopsWorkitemsBatchUpdate = defineTool({
    name: 'devops_workitems_batch_update',
    group: 'DevOps',
    description:
      'Batch-update a field on MULTIPLE work items in a single call. ' +
      'Accepts an array of item IDs, a standard field name or custom field ref, and a value. ' +
      'Processes items in parallel batches of 5. Returns per-item success/failure. ' +
      '🔥 Preferred over editing work items one-by-one via drawer (which requires 5 steps per item).',
    parameters: z.object({
      items: z
        .array(z.object({ id: z.number().int().describe('Work item numeric ID') }))
        .describe('Array of work items to update. Can pass [{id: 123}, {id: 456}, ...].'),
      field: z
        .string()
        .describe(
          'Field to update. Standard fields: "state", "assignedTo", "priority", "title", "iterationPath", ' +
          '"areaPath", "tags", "description". ' +
          'Custom fields: use the full ADO reference name like "Custom.f145ff4d-..." or "Custom.AiUsageLevel". ' +
          'For custom fields, the value is set via customFields automatically.',
        ),
      value: z.string().describe('Value to set on all items. Must match picklist allowed values for dropdown fields.'),
    }),
    execute: async ({ items, field, value }) => {
      // Determine if this is a standard or custom field
      const isCustomField = field.startsWith('Custom.');
      const results = await bridge.callHandler<Array<{ id: number; success: boolean; error?: string }>>(
        'wi.batchUpdate',
        items.map((i) => i.id),
        field,
        value,
        isCustomField,
      );
      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      return {
        total: items.length,
        succeeded: succeeded.length,
        failed: failed.length,
        details: results,
      };
    },
  });

  return [devopsWorkitemsBatchUpdate];
}
