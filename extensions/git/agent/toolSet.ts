/**
 * extensions/git/agent/toolSet.ts — Git ToolSet factory
 */

import type { ToolSet, ToolSetContext, PluginSlotDeclaration, CompactToolCardDescriptor, ToolCallInfo } from '@agent-type';
import type { GitAdapter } from './types';
import { createGitTools } from './tools';

export const GIT_SYMBOL = Symbol('git');

function gitDescriptor(info: ToolCallInfo): CompactToolCardDescriptor {
  const summary = info.status === 'running' ? `${info.name}…` : info.name;
  return { icon: '\uD83D\uDCBB', label: 'Git', summary, status: info.status };
}

export function createGitToolSet(adapter: GitAdapter): ToolSet {
  const { tools, getSystemPrompt } = createGitTools(adapter);

  return {
    name: 'git',
    symbol: GIT_SYMBOL,
    description: 'Git status, diff, log, stage, unstage, commit, and discard operations',
    coreTools: ['git_status', 'git_diff', 'git_stage', 'git_commit'],
    tools,
    onGetSystemPrompt: () => getSystemPrompt(),

    onGetSymbolState: (_ctx: ToolSetContext) => ({
      type: 'git' as const,
    }),
  };
}

export function getGitSlotDeclarations(
  toolNames: readonly string[],
): readonly PluginSlotDeclaration[] {
  return [
    { type: 'toolCard' as const, toolNames },
    { type: 'compactToolCard' as const, toolNames, getDescriptor: gitDescriptor },
  ] satisfies readonly PluginSlotDeclaration[];
}
