/**
 * depTools.ts — Meta-tools for managing npm dependencies in the tool-scripts
 * package scope (data/tool-scripts/).
 *
 * Installed packages are importable directly in backend tool scripts:
 *   import axios from 'axios';
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DynamicToolAdapter } from './types';

// ── Factory ───────────────────────────────────────────────────────────────────

export function createDepTools(adapter: DynamicToolAdapter) {
  // ── list_tool_deps ─────────────────────────────────────────────────────────

  const listToolDepsTool = defineTool({
    name: 'list_tool_deps',
    group: 'Dynamic Tools',
    isReadOnly: true,
    description:
      'List npm packages installed in the tool-scripts scope. ' +
      'Always call this before install_tool_deps — the package may already be installed.',
    parameters: z.object({}),
    execute: async () => {
      return adapter.listDeps();
    },
  });

  // ── install_tool_deps ──────────────────────────────────────────────────────

  const installToolDepsTool = defineTool({
    name: 'install_tool_deps',
    group: 'Dynamic Tools',
    description:
      'Install one or more npm packages into the tool-scripts scope. ' +
      'After installation, backend tools can import them directly: `import axios from "axios"`. ' +
      'Accepts version specifiers: ["axios@1", "lodash@^4", "@scope/pkg"].',
    parameters: z.object({
      packages: z
        .array(z.string())
        .min(1)
        .describe('npm package names to install, e.g. ["axios", "lodash@4", "@types/node"].'),
    }),
    execute: async ({ packages }) => {
      const result = await adapter.installDeps(packages);
      if (!result.success) {
        throw new Error(`Package installation failed:\n${result.output}`);
      }
      return {
        installed: result.packages,
        message: `Installed: ${result.packages.join(', ')}. Import normally in backend tools.`,
        output: result.output,
      };
    },
  });

  // ── remove_tool_dep ────────────────────────────────────────────────────────

  const removeToolDepTool = defineTool({
    name: 'remove_tool_dep',
    group: 'Dynamic Tools',
    isDestructive: true,
    description:
      'Remove an npm package from the tool-scripts scope. ' +
      'Any backend tool importing it will fail until reinstalled.',
    parameters: z.object({
      package: z.string().describe('Bare package name to remove (no version specifier), e.g. "axios".'),
    }),
    execute: async ({ package: pkg }) => {
      const result = await adapter.removeDep(pkg);
      if (!result.success) {
        throw new Error(`Package removal failed:\n${result.output}`);
      }
      return {
        removed: pkg,
        message: `Package "${pkg}" removed from tool-scripts scope.`,
      };
    },
  });

  return [listToolDepsTool, installToolDepsTool, removeToolDepTool] as const;
}
