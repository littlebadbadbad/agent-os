/**
 * Terminal lifecycle tools: list, create, remove.
 */

import { z } from 'zod';
import { defineTool } from '@agent-type/defineTool';
import type { TerminalManagerAdapter } from '../types';

export function createLifecycleTools(adapter: TerminalManagerAdapter) {
  const terminalListTool = defineTool({
    name:  'terminal_list',
    group: 'Terminal',
    description: 'List active terminal instances.',
    parameters: z.object({}),
    execute: async (_, context) => ({
      terminals: await adapter.listTerminals({ sessionId: context.sessionId }),
    }),
  });

  const terminalCreateTool = defineTool({
    name:  'terminal_create',
    group: 'Terminal',
    description: 'Open a new shell terminal and return its id. ' +
      'Reuse an existing terminal (terminal_list) when possible.',
    parameters: z.object({
      shell: z.string().optional().describe(
        'Shell executable, e.g. "pwsh", "bash", "cmd.exe". Supports inline args: "wsl -d Ubuntu". Defaults to host default.',
      ),
      label: z.string().optional().describe('Human-readable label for the terminal tab.'),
      cwd: z.string().optional().describe(
        'Working directory, e.g. "/home/user/project" or "D:\\\\myapp". Defaults to backend cwd.',
      ),
    }),
    execute: async ({ shell, label, cwd }, context) =>
      adapter.createTerminal({ shell, label, cwd, sessionId: context.sessionId }),
  });

  const terminalRemoveTool = defineTool({
    name:        'terminal_remove',
    group:       'Terminal',
    description: 'Kill and remove a terminal instance.',
    parameters:  z.object({
      id: z.string().describe('Terminal id to remove.'),
    }),
    execute: async ({ id }, context) => {
      await adapter.removeTerminal(id, context.sessionId);
      return { removed: id };
    },
  });

  return [terminalListTool, terminalCreateTool, terminalRemoveTool] as const;
}
