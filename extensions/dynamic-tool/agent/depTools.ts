/**
 * extensions/dynamic-tool/agent/depTools.ts — Meta-tools for npm dependency management
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { DynamicToolAdapter } from './types';

export function createDepTools(adapter: DynamicToolAdapter) {
  const listToolDepsTool = defineTool({
    name: 'list_tool_deps',
    group: 'Dynamic Tools',
    isReadOnly: true,
    description: 'List npm packages installed in the tool-scripts scope.',
    parameters: z.object({}),
    execute: async () => adapter.listDeps(),
  });

  const installToolDepsTool = defineTool({
    name: 'install_tool_deps',
    group: 'Dynamic Tools',
    description:
      'Install one or more npm packages into the tool-scripts scope. ' +
      'After installation, backend tools can import them directly: `import axios from "axios"`.',
    parameters: z.object({
      packages: z.array(z.string()).min(1)
        .describe('npm package names to install, e.g. ["axios", "lodash@4", "@types/node"].'),
    }),
    execute: async ({ packages }) => {
      const result = await adapter.installDeps(packages);
      if (!result.success) throw new Error(`Package installation failed:\n${result.output}`);
      return { installed: result.packages, message: `Installed: ${result.packages.join(', ')}.`, output: result.output };
    },
  });

  const removeToolDepTool = defineTool({
    name: 'remove_tool_dep',
    group: 'Dynamic Tools',
    isDestructive: true,
    description: 'Remove an npm package from the tool-scripts scope.',
    parameters: z.object({
      package: z.string().describe('Bare package name to remove (no version specifier), e.g. "axios".'),
    }),
    execute: async ({ package: pkg }) => {
      const result = await adapter.removeDep(pkg);
      if (!result.success) throw new Error(`Package removal failed:\n${result.output}`);
      return { removed: pkg, message: `Package "${pkg}" removed from tool-scripts scope.` };
    },
  });

  return [listToolDepsTool, installToolDepsTool, removeToolDepTool] as const;
}
