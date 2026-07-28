/**
 * extensions/dynamic-tool/agent/moduleTools.ts — Meta-tools for shared ESM modules
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DynamicToolAdapter } from './types';

export function createModuleTools(adapter: DynamicToolAdapter) {
  const createModuleTool = defineTool({
    name: 'create_module',
    group: 'Dynamic Tools',
    description: 'Create a shared ESM module for backend tool imports.',
    parameters: z.object({
      name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Must be kebab-case, e.g. "string-utils"')
        .describe('Kebab-case name, e.g. "string-utils".'),
      description: z.string().describe('What this module provides.'),
      content: z.string().describe('Full ESM source. Must contain at least one export.'),
    }),
    execute: async ({ name, description, content }) => {
      await adapter.createModule({ name, description, content });
      return {
        created: name,
        message: `Module "${name}" created.\nImport in backend tools: import { ... } from '#modules/${name}';`,
      };
    },
  });

  const listModulesTool = defineTool({
    name: 'list_modules',
    group: 'Dynamic Tools',
    isReadOnly: true,
    description: 'List all shared modules.',
    parameters: z.object({}),
    execute: async () => {
      const modules = await adapter.listModules();
      if (modules.length === 0) return { message: 'No shared modules exist yet.', modules: [] };
      return {
        count: modules.length,
        modules: modules.map(({ name, description, createdAt }) => ({ name, description, createdAt })),
        hint: 'Import in backend tools: import { x } from \'#modules/<name>\';',
      };
    },
  });

  const getModuleTool = defineTool({
    name: 'get_module',
    group: 'Dynamic Tools',
    isReadOnly: true,
    description: 'Retrieve the full source content of a shared module.',
    parameters: z.object({ name: z.string().describe('The exact kebab-case module name.') }),
    execute: async ({ name }) => adapter.getModule(name),
  });

  const updateModuleTool = defineTool({
    name: 'update_module',
    group: 'Dynamic Tools',
    description: 'Update an existing shared module. Provide only the fields you want to change.',
    parameters: z.object({
      name: z.string().describe('The exact kebab-case module name.'),
      description: z.string().optional().describe('New description.'),
      content: z.string().optional().describe('New full ESM source \u2014 must contain at least one export.'),
    }),
    execute: async ({ name, description, content }) => {
      await adapter.updateModule(name, { description, content });
      return { updated: name, message: `Module "${name}" updated.` };
    },
  });

  const deleteModuleTool = defineTool({
    name: 'delete_module',
    group: 'Dynamic Tools',
    isDestructive: true,
    description: 'Permanently delete a shared module.',
    parameters: z.object({ name: z.string().describe('The exact kebab-case module name to delete.') }),
    execute: async ({ name }) => {
      await adapter.deleteModule(name);
      return { deleted: name, message: `Module "${name}" deleted.` };
    },
  });

  return [createModuleTool, listModulesTool, getModuleTool, updateModuleTool, deleteModuleTool] as const;
}
