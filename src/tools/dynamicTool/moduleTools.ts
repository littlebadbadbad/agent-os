/**
 * moduleTools.ts — Meta-tools for managing shared ESM modules.
 *
 * Shared modules live at data/tool-scripts/modules/<name>.mjs on the backend.
 * Backend tool scripts can import them via:
 *   import { helper } from '#modules/name';
 *
 * At execution time the import is rewritten to a per-run temp copy so Node.js
 * never serves a stale cached version.
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DynamicToolAdapter } from './types';

// ── Factory ───────────────────────────────────────────────────────────────────

export function createModuleTools(adapter: DynamicToolAdapter) {
  // ── create_module ──────────────────────────────────────────────────────────

  const createModuleTool = defineTool({
    name: 'create_module',
    group: 'Dynamic Tools',
    description:
      'Create a shared ESM module that backend tool scripts can import via ' +
      '`import { x } from \'#modules/name\'`. ' +
      'Use kebab-case names (e.g. "string-utils", "http-client"). ' +
      'Run list_modules first — prefer update_module over creating near-duplicates.',
    parameters: z.object({
      name: z
        .string()
        .regex(/^[a-z][a-z0-9-]*$/, 'Must be kebab-case (e.g. "string-utils")')
        .describe('Kebab-case module name, e.g. "string-utils" or "http-client".'),
      description: z
        .string()
        .describe('Clear description of what the module provides.'),
      content: z
        .string()
        .describe(
          'Full ESM source (.mjs). Must contain at least one `export` statement. ' +
          'Example: `export function trim(s) { return s.trim(); }`',
        ),
    }),
    execute: async ({ name, description, content }) => {
      await adapter.createModule({ name, description, content });
      return {
        created: name,
        message:
          `Module "${name}" created.\n` +
          `Import in backend tools: import { ... } from '#modules/${name}';`,
      };
    },
  });

  // ── list_modules ───────────────────────────────────────────────────────────

  const listModulesTool = defineTool({
    name: 'list_modules',
    group: 'Dynamic Tools',
    isReadOnly: true,
    description:
      'List all shared modules available for import in backend tool scripts. ' +
      'Always call this before create_module to avoid duplicates.',
    parameters: z.object({}),
    execute: async () => {
      const modules = await adapter.listModules();
      if (modules.length === 0) {
        return { message: 'No shared modules exist yet.', modules: [] };
      }
      return {
        count: modules.length,
        modules: modules.map(({ name, description, createdAt }) => ({ name, description, createdAt })),
        hint: 'Import in backend tools: import { x } from \'#modules/<name>\';',
      };
    },
  });

  // ── get_module ─────────────────────────────────────────────────────────────

  const getModuleTool = defineTool({
    name: 'get_module',
    group: 'Dynamic Tools',
    isReadOnly: true,
    description: 'Retrieve the full source content of a shared module.',
    parameters: z.object({
      name: z.string().describe('The exact kebab-case module name.'),
    }),
    execute: async ({ name }) => {
      return adapter.getModule(name);
    },
  });

  // ── update_module ──────────────────────────────────────────────────────────

  const updateModuleTool = defineTool({
    name: 'update_module',
    group: 'Dynamic Tools',
    description: 'Update an existing shared module. Provide only the fields you want to change.',
    parameters: z.object({
      name: z.string().describe('The exact kebab-case module name.'),
      description: z.string().optional().describe('New description.'),
      content: z.string().optional().describe('New full ESM source — must contain at least one export.'),
    }),
    execute: async ({ name, description, content }) => {
      await adapter.updateModule(name, { description, content });
      return {
        updated: name,
        message: `Module "${name}" updated.`,
      };
    },
  });

  // ── delete_module ──────────────────────────────────────────────────────────

  const deleteModuleTool = defineTool({
    name: 'delete_module',
    group: 'Dynamic Tools',
    isDestructive: true,
    description:
      'Permanently delete a shared module. ' +
      'Any backend tool importing it will fail until the module is recreated.',
    parameters: z.object({
      name: z.string().describe('The exact kebab-case module name to delete.'),
    }),
    execute: async ({ name }) => {
      await adapter.deleteModule(name);
      return {
        deleted: name,
        message: `Module "${name}" deleted.`,
      };
    },
  });

  return [createModuleTool, listModulesTool, getModuleTool, updateModuleTool, deleteModuleTool] as const;
}
