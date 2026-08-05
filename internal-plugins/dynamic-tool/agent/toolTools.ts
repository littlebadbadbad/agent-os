/**
 * internal-plugins/dynamic-tool/agent/toolTools.ts — Meta-tools for tool CRUD
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DynamicToolAdapter, DynamicToolEntry } from './types';

export function createToolCrudTools(
  adapter: DynamicToolAdapter,
  onRegister: (entry: DynamicToolEntry) => void,
  onUnregister: (name: string) => void,
) {
  const createToolTool = defineTool({
    name: 'create_tool',
    group: 'Dynamic Tools',
    description: 'Create and register a new dynamic tool.',
    parameters: z.object({
      name: z.string().describe('Snake_case name, e.g. "fetch_weather". Must be unique.'),
      description: z.string().describe('Description shown to the AI when calling this tool.'),
      parameters_schema: z.record(z.string(), z.unknown()).optional()
        .describe('JSON Schema for tool arguments. Defaults to empty object schema.'),
      implementation: z.string().describe('Source code. Backend: full ESM. Frontend: bare function body.'),
      runtime: z.enum(['backend', 'frontend']).default('backend')
        .describe('"backend" (Node.js ESM) or "frontend" (browser JS).'),
    }),
    execute: async ({ name, description, parameters_schema, implementation, runtime }) => {
      const entry = await adapter.createTool({
        name, description,
        parameters: parameters_schema ?? { type: 'object', properties: {} },
        implementation, runtime,
      });
      onRegister(entry);
      return { created: name, message: `Tool "${name}" created and registered (runtime: ${runtime}).` };
    },
  });

  const listDynamicToolsTool = defineTool({
    name: 'list_dynamic_tools',
    group: 'Dynamic Tools',
    isReadOnly: true,
    description: 'List all persisted dynamic tools.',
    parameters: z.object({}),
    execute: async () => {
      const tools = await adapter.listTools();
      if (tools.length === 0) return { message: 'No custom tools have been created yet.', tools: [] };
      return {
        count: tools.length,
        tools: tools.map(({ name, description, runtime, createdAt }) => ({ name, description, runtime, createdAt })),
      };
    },
  });

  const updateToolTool = defineTool({
    name: 'update_tool',
    group: 'Dynamic Tools',
    description: 'Update an existing dynamic tool. Provide only the fields to change.',
    parameters: z.object({
      name: z.string().describe('The exact tool name to update.'),
      description: z.string().optional().describe('New description.'),
      parameters_schema: z.record(z.string(), z.unknown()).optional().describe('New JSON Schema for arguments.'),
      implementation: z.string().optional().describe('New source code.'),
      runtime: z.enum(['backend', 'frontend']).optional().describe('Change execution environment.'),
    }),
    execute: async ({ name, description, parameters_schema, implementation, runtime }) => {
      const patch: Parameters<DynamicToolAdapter['updateTool']>[1] = {
        ...(description !== undefined && { description }),
        ...(parameters_schema !== undefined && { parameters: parameters_schema }),
        ...(implementation !== undefined && { implementation }),
        ...(runtime !== undefined && { runtime }),
      };
      const updated = await adapter.updateTool(name, patch);
      onRegister(updated);
      return { updated: name, message: `Tool "${name}" updated and re-registered.` };
    },
  });

  const deleteToolTool = defineTool({
    name: 'delete_tool',
    group: 'Dynamic Tools',
    isDestructive: true,
    description: 'Permanently delete a dynamic tool.',
    parameters: z.object({ name: z.string().describe('The exact tool name to delete.') }),
    execute: async ({ name }) => {
      onUnregister(name);
      await adapter.deleteTool(name);
      return { deleted: name, message: `Tool "${name}" deleted and unregistered.` };
    },
  });

  return [createToolTool, listDynamicToolsTool, updateToolTool, deleteToolTool] as const;
}
